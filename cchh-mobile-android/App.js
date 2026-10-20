import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, FlatList,
  KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { createPublicPairing, claimPublicPairing, publicSessionActive, parsePairingText } from './remotePairing.mjs';
import { parsePrivatePairingQr } from './privatePairing.mjs';
import { splitFences } from './messageText.mjs';
import { isForegroundResume, reconnectDelayMs } from './mobileRecovery.mjs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

const STORE_KEY = 'cchh-mobile-android-connection-v1';
const C = { bg:'#101215', surface:'#1B1F24', surface2:'#262B32', line:'#363B43',
  text:'#F5F6F7', muted:'#A6ACB5', accent:'#F5AF69', green:'#7FD9A6', red:'#F18686' };

function endpoint(raw) {
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '/' && url.pathname !== ''))
    throw new Error('地址格式不正确：仅填写服务器地址和端口，不带路径、账号或参数');
  if (url.protocol === 'http:') {
    const h = url.hostname.toLowerCase();
    const chunks = h.split('.').map(Number);
    const validIP = chunks.length === 4 && chunks.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
    const privateIp = validIP && (chunks[0] === 10 ||
      (chunks[0] === 172 && chunks[1] >= 16 && chunks[1] <= 31) ||
      (chunks[0] === 192 && chunks[1] === 168) ||
      (chunks[0] === 100 && chunks[1] >= 64 && chunks[1] <= 127) ||
      (chunks[0] === 127));
    if (!privateIp && h !== 'localhost')
      throw new Error('公网地址必须使用 HTTPS；HTTP 仅允许局域网或 Tailscale IP');
  }
  return url.origin;
}
async function getJson(config, path) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(config.baseUrl + path, {
      headers: config.mode === 'public' ? {Origin:config.baseUrl,Accept:'application/json'} : {Authorization:'Bearer ' + config.token},
      credentials: config.mode === 'public' ? 'include' : 'omit',
      signal: ctl.signal
    });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403
      ? '访问被拒绝，请检查 H5 令牌、配对及远程访问设置' : '服务器错误 ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}
function textFromContent(value) {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter(v => v && v.type === 'text' && typeof v.text === 'string')
    .map(v => v.text).join('\n');
}
function messagesFromHistory(payload) {
  return (payload.messages || []).filter(m => m.type === 'user' || m.type === 'assistant')
    .map(m => ({
      id: String(m.id), role: m.type, text: textFromContent(m.content),
      timestamp: m.timestamp || ''
    })).filter(m => m.text);
}
function MessageBody({text}) {
  return splitFences(text).map((part,index) => <Text key={index} selectable
    style={part.code?styles.codeText:styles.bubbleText}>{part.text}</Text>);
}
function Btn({ label, onPress, disabled, outline, danger }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={({pressed}) => [styles.btn, outline && styles.btnOutline,
      danger && styles.btnDanger, (disabled || pressed) && {opacity:0.55}]}>
    <Text style={[styles.btnText, outline && {color:C.text}, danger && {color:C.red}]}>{label}</Text>
  </Pressable>;
}

function Main() {
  const [config, setConfig] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [mode, setMode] = useState('private');
  const [networkType, setNetworkType] = useState('lan');
  const [scanKind, setScanKind] = useState('public');
  const [showGuide, setShowGuide] = useState(true);
  const [pairSecret, setPairSecret] = useState('');
  const [pairing, setPairing] = useState(null);
  const [pairNotice, setPairNotice] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [draft, setDraft] = useState('');
  const [socketState, setSocketState] = useState('未连接');
  const [stream, setStream] = useState('');
  const [turnBusy, setTurnBusy] = useState(false);
  const [approvals, setApprovals] = useState([]);
  const [search, setSearch] = useState('');
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const pingRef = useRef(null);
  const pongRef = useRef(null);
  const sendLock = useRef(false);
  const selectedId = useRef(null);
  const chatList = useRef(null);
  const keepScroll = useRef(false);
  selectedId.current = selected?.id || null;

  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(STORE_KEY).then(v => {
      if (v && alive) {
        try { const saved = JSON.parse(v); if(saved.baseUrl && (saved.token || saved.mode === 'public')) setConfig(saved); }
        catch {}
      }
    }).catch(() => {}).finally(() => { if(alive) setRestoring(false); });
    return () => { alive = false; };
  }, []);

  async function listSessions(current = config) {
    if (!current) return;
    try {
      setLoading(true); setError('');
      const data = await getJson(current, '/api/sessions?limit=100');
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (e) { setError(e.message || '加载会话失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if(config && !selected) listSessions(config); }, [config, selected?.id]);

  const connect = async () => {
    if(loading) return;
    setLoading(true); setError(''); setPairNotice('');
    try {
      if(mode === 'public') {
        let rawUrl=url.trim(), code=pairSecret.trim();
        if(code.startsWith('https://')) {
          const parsed=parsePairingText(code);
          code=parsed.secret;
          if(!rawUrl) {rawUrl=parsed.baseUrl;setUrl(rawUrl);}
        }
        const baseUrl=endpoint(rawUrl);
        if(!baseUrl.startsWith('https://')) throw new Error('公网配对只支持 HTTPS 地址');
        const next={mode:'public',baseUrl,token:''};
        if(!pairing || pairing.baseUrl!==baseUrl) {
          const request=await createPublicPairing(baseUrl,code,'CCHH Mobile Android');
          setPairing({...request,baseUrl});
          setPairNotice('配对请求已提交。请在电脑 CCHH 的公网访问设置中批准手机，然后点击“检查审批并连接”。二维码约 5 分钟有效。');
          return;
        }
        const result=await claimPublicPairing(baseUrl,pairing);
        if(result.status==='pending') {
          setPairNotice('电脑还没有批准当前配对请求。批准之后再点一次。');
          return;
        }
        if(result.status==='rejected') {setPairing(null);throw new Error('电脑端拒绝了配对，请重新生成配对码');}
        if(result.status!=='approved'||!await publicSessionActive(baseUrl)) throw new Error('手机尚未取得有效公网 Cookie，请重新配对');
        await SecureStore.setItemAsync(STORE_KEY,JSON.stringify(next));
        setPairing(null);setPairSecret('');setConfig(next);
      } else {
        const next={mode:'private',baseUrl:endpoint(url),token:token.trim()};
        if(!next.token)throw new Error('请输入 CCHH 的 H5 访问令牌');
        await getJson(next,'/api/sessions?limit=1');
        await SecureStore.setItemAsync(STORE_KEY,JSON.stringify(next));
        setToken('');setConfig(next);
      }
    } catch(e) {setError(e.message||'连接失败');}
    finally {setLoading(false);}
  };
  function chooseConnection(next) {
    setMode(next === 'public' ? 'public' : 'private');
    setNetworkType(next);
    // Do not carry credentials or pending pairing state across connection choices.
    setUrl(''); setToken(''); setPairSecret(''); setPairing(null);
    setPairNotice(''); setScanning(false); setError('');
  }
  async function startQrScan(kind) {
    setScanKind(kind);
    setError('');
    try {
      if(!cameraPermission?.granted) {
        const result=await requestCameraPermission();
        if(!result.granted) {setError('需要允许使用摄像头才能扫描配对二维码');return;}
      }
      setScanning(true);
    } catch {setError('无法启用摄像头，请手动粘贴二维码链接');}
  }
  function onQrScanned(data) {
    if(!scanning) return;
    setScanning(false);
    try {
      if(scanKind === 'private') {
        const parsed = parsePrivatePairingQr(data?.data||'');
        setMode('private'); setUrl(parsed.baseUrl); setToken(parsed.token);
        setPairing(null); setPairSecret(''); setError('');
        const isLanQr = parsed.baseUrl.startsWith('http://192.168.') ||
          parsed.baseUrl.startsWith('http://10.') ||
          parsed.baseUrl.startsWith('http://172.');
        setPairNotice(networkType === 'tailscale' && isLanQr
          ? '已识别电脑 H5 令牌，但地址仍是局域网地址。请改为同一台电脑的 Tailscale 100.x 地址。'
          : '已识别 H5 二维码。请核对电脑地址后点击连接；扫码不会自动发送任务。');
      } else {
        const parsed=parsePairingText(data?.data||'');
        if(!parsed.baseUrl) throw new Error('扫描到的不是公网配对链接');
        setMode('public');setUrl(parsed.baseUrl);setPairSecret(data.data);
        setPairing(null);setPairNotice('二维码识别成功，点击“申请公网手机配对”开始。');setError('');
      }
    } catch(e) {setError(e.message||'二维码无法识别');}
  }
  async function logout() {
    try {
      if(config?.mode === 'public') await CookieManager.clearByName(config.baseUrl,'__Host-haha-remote');
      await SecureStore.deleteItemAsync(STORE_KEY);
      setSelected(null);setConfig(null);setSessions([]);
      setHistory([]);setApprovals([]);setStream('');
      setUrl('');setToken('');setPairSecret('');setPairing(null);
      setPairNotice('');setMode('private');setNetworkType('lan');
      setScanning(false);setError('');
    } catch {
      Alert.alert('无法解除配对','请重试，并在电脑端撤销旧设备授权。');
    }
  }
  async function loadHistory(session, older = false) {
    if(!config || !session) return;
    if(older) keepScroll.current = true;
    try {
      const path = '/api/sessions/' + encodeURIComponent(session.id) + '/messages' +
        (older && cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
      const payload = await getJson(config, path);
      if(selectedId.current !== session.id) return;
      const loaded = messagesFromHistory(payload);
      setHistory(prev => {
        if(older) {
          const seen = new Set(prev.map(m => m.id));
          return [...loaded.filter(m => !seen.has(m.id)), ...prev];
        }
        const confirmed = new Set();
        const pending = prev.filter(m => {
          if(!m.pending) return false;
          const match = loaded.find(x => x.role === 'user' && x.text === m.text &&
            !m.knownUserIds.includes(x.id) && !confirmed.has(x.id));
          if(!match) return true;
          confirmed.add(match.id);
          return false;
        });
        return [...loaded, ...pending];
      });
      if(!older) setHistoryReady(true);
      setCursor(payload.page?.nextCursor || null);
    } catch(e) { if(older) keepScroll.current = false; setError(e.message || '读取消息失败'); }
  }

  useEffect(() => {
    if(!config || !selected) return;
let cancelled = false, tries = 0, handshake = null, previousAppState = AppState.currentState;
    setHistory([]); setHistoryReady(false); setCursor(null); setApprovals([]); setStream(''); keepScroll.current=false;
    setTurnBusy(false); sendLock.current = true; setDraft('');
    setSocketState('连接中'); loadHistory(selected);
    function clearConn() {
      clearTimeout(reconnectRef.current); clearTimeout(handshake); clearInterval(pingRef.current); clearTimeout(pongRef.current);
      if(wsRef.current) { const s=wsRef.current; wsRef.current=null; try { s.close(); } catch{} }
    }
    function open() {
      if(cancelled) return;
      sendLock.current=true;
      const u = new URL(config.baseUrl);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.pathname = '/ws/' + encodeURIComponent(selected.id);
      if(config.mode!=='public') u.searchParams.set('token', config.token);
      let ws;
      try { ws = config.mode==='public'
        ? new WebSocket(u.toString(),undefined,{headers:{origin:config.baseUrl}})
        // Stock CCHH 0.7.4 rejects any WebSocket browser Origin that is not
        // localhost/file://. A native app has no web origin, so declare the
        // desktop app's own local origin instead of the LAN IP.
        : new WebSocket(u.toString(),undefined,{headers:{origin:'file://'}}); }
      catch { schedule(); return; }
      wsRef.current = ws; setSocketState(tries ? '重连中' : '连接中');
      handshake = setTimeout(() => { try { ws.close(); } catch{} }, 15000);
      ws.onopen = () => {
        if(wsRef.current !== ws) return;
        clearTimeout(handshake); tries=0; setSocketState('同步中');
        ws.send(JSON.stringify({type:'sync_state'}));
pingRef.current = setInterval(() => {
          if(cancelled || wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
          try {
            ws.send(JSON.stringify({type:'ping'}));
            clearTimeout(pongRef.current);
            pongRef.current = setTimeout(() => {
              if(!cancelled && wsRef.current === ws && ws.readyState === WebSocket.OPEN) {
                try { ws.close(); } catch {}
              }
            }, 12000);
          } catch { try { ws.close(); } catch {} }
        }, 30000);
        loadHistory(selected);
      };
      ws.onmessage = ev => {
if(wsRef.current !== ws) return;
        let msg; try { msg=JSON.parse(ev.data); } catch { return; }
        if(msg.type === 'pong') { clearTimeout(pongRef.current); return; }
        if(msg.type === 'content_delta' && typeof msg.text === 'string')
          setStream(prev => prev + msg.text);
        else if(msg.type === 'content_start' && msg.blockType === 'text') setStream('');
        else if(msg.type === 'message_complete') {
          setTurnBusy(false); sendLock.current=false; setStream(''); loadHistory(selected);
        } else if(msg.type === 'session_state') {
          const busy = msg.turnState === 'running';
          setTurnBusy(busy); sendLock.current=busy; setSocketState('已连接');
        } else if(msg.type === 'status' && msg.state === 'idle') {
          setTurnBusy(false); sendLock.current=false; setStream('');
        } else if(msg.type === 'permission_request') {
          if(!msg.requestId) return;
          setApprovals(prev => prev.some(p => p.requestId === msg.requestId)
            ? prev : [...prev, msg]);
        } else if(msg.type === 'permission_resolved') {
          setApprovals(prev => prev.filter(p => p.requestId !== msg.requestId));
        } else if(msg.type === 'permission_requests_snapshot') {
          setApprovals(prev => prev.filter(p => (msg.toolRequestIds || []).includes(p.requestId)));
        } else if(msg.type === 'error') {
          setError(msg.message || 'CCHH 返回错误'); setTurnBusy(false); sendLock.current=false;
        }
      };
      ws.onerror = () => { try { ws.close(); } catch{} };
      ws.onclose = () => {
        if(wsRef.current !== ws) return;
        clearTimeout(handshake); clearInterval(pingRef.current);
        wsRef.current=null;
        if(!cancelled) schedule();
      };
    }
function schedule() {
      if(cancelled) return;
      clearTimeout(reconnectRef.current);
      setSocketState('正在重连');
      tries++; reconnectRef.current=setTimeout(open, reconnectDelayMs(tries));
    }
    open();
    const foreground = AppState.addEventListener('change', state => {
      if(isForegroundResume(previousAppState, state)) {
        clearConn(); tries=0; open(); loadHistory(selected);
      }
      previousAppState=state;
    });
    return () => {cancelled=true; foreground.remove(); clearConn();};
  }, [config,selected?.id]);

  useEffect(() => {
    const handler=BackHandler.addEventListener('hardwareBackPress', () => {
      if(selected) { setSelected(null); setError(''); return true; }
      return false;
    });
    return () => handler.remove();
  },[selected]);

  function sendPacket(packet) {
    const ws=wsRef.current;
    if(!ws || ws.readyState !== WebSocket.OPEN) { setError('连接尚未恢复，请检查网络'); return false; }
    try { ws.send(JSON.stringify(packet)); return true; }
    catch {setError('发送失败，请先查看会话历史确认是否执行，避免重复提交'); return false;}
  }
  function send() {
    const content=draft.trim();
    if(!content || !historyReady || sendLock.current) return;
    if(!sendPacket({type:'user_message',content})) return;
    sendLock.current=true; setTurnBusy(true); setDraft('');
    const knownUserIds=history.filter(m=>m.role==='user' && !m.pending && m.text===content).map(m=>m.id);
    setHistory(prev => [...prev, {id:'local-'+Date.now(),role:'user',text:content,timestamp:new Date().toISOString(),pending:true,knownUserIds}]);
  }
  function decision(request, allowed) {
    if(sendPacket({type:'permission_response',requestId:request.requestId,allowed})) {
      setApprovals(prev => prev.filter(p => p.requestId !== request.requestId));
    }
  }

  if(restoring) return <View style={styles.center}><ActivityIndicator color={C.accent} /></View>;
  if(!config) return <SafeAreaView style={styles.flex}><StatusBar style="light" />
    <ScrollView contentContainerStyle={styles.connect}>
      <View style={styles.logo}><Text style={styles.logoText}>C</Text></View>
      <Text style={styles.h1}>连接我自己的 CCHH</Text>
      <Text style={styles.muted}>CCHH Mobile · 免费通用版测试</Text>
      <Text style={styles.muted}>同一个免费 APP，每个人独立连接自己的电脑。不共享 CCHH 账号或 API Key。</Text>
      <View style={styles.guideCard}>
        <Pressable accessibilityRole="button" onPress={()=>setShowGuide(v=>!v)}>
          <Text style={styles.guideTitle}>{showGuide?'▼':'▶'} 首次连接指引</Text>
        </Pressable>
        {showGuide && <>
          <Text style={styles.guideStep}>① 在自己的电脑打开 CCHH 0.7.4 → 设置 → H5 访问，启用访问。</Text>
          <Text style={styles.guideStep}>② 选择免费连接方式，扫描这台电脑对应的二维码。</Text>
          <Text style={styles.guideStep}>③ 核对地址并连接。公网模式还需在电脑端批准手机。</Text>
          <Text style={styles.guideWarning}>不要把带令牌的二维码发给其他人，手机只能配对自己授权的电脑。</Text>
        </>}
      </View>
      <Text style={styles.label}>免费连接方式（第三方免费额度可能调整）</Text>
      <View style={{flexDirection:'row',gap:8}}>
        <View style={{flex:1}}><Btn label="同一 Wi-Fi" outline={networkType!=='lan'} onPress={()=>chooseConnection('lan')} /></View>
        <View style={{flex:1}}><Btn label="Tailscale" outline={networkType!=='tailscale'} onPress={()=>chooseConnection('tailscale')} /></View>
      </View>
      <Btn label="公网 ngrok · 免费额度（实验性）" outline={networkType!=='public'} onPress={()=>chooseConnection('public')} />
      <Text style={styles.guideStep}>{mode==='public'
        ? '电脑打开「H5 访问 → 公网 ngrok」，使用自己的免费账户开通后生成公网配对二维码。'
        : networkType==='tailscale'
          ? '先让手机和电脑加入自己的 Tailscale 网络；扫码读取 H5 令牌后，确认地址是电脑的 100.x 私网地址。'
          : '手机和电脑连接同一个可信 Wi-Fi，然后扫描自己电脑「H5 访问」中的二维码。'}</Text>
      <View style={{marginTop:8}}><Btn label={mode==='public'?'扫描公网配对二维码':'扫描电脑 H5 二维码'} outline onPress={()=>startQrScan(mode==='public'?'public':'private')} /></View>
      {scanning && <View style={{height:270,marginTop:12,borderRadius:16,overflow:'hidden'}}>
        <CameraView style={{flex:1}} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}}
          onBarcodeScanned={onQrScanned} />
        <View style={{position:'absolute',bottom:8,right:8}}><Btn label="取消扫码" outline onPress={()=>setScanning(false)} /></View>
      </View>}
      <Text style={styles.label}>{mode==='public'?'ngrok HTTPS 公网地址':'我的 CCHH 服务器地址'}</Text>
      <TextInput style={styles.input} value={url} onChangeText={setUrl}
        autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholderTextColor={C.muted}
        placeholder={mode==='public'?'https://your-subdomain.ngrok-free.app':'http://100.101.102.103:3456'} />
      {mode==='public' ? <>
        <Text style={styles.label}>一次性配对密钥（或完整二维码链接）</Text>
        <TextInput style={styles.input} value={pairSecret} onChangeText={value=>{setPairSecret(value);setPairing(null);}}
          autoCapitalize="none" autoCorrect={false} placeholderTextColor={C.muted}
          placeholder="电脑生成的公网配对密钥" />
      </> : <>
        <Text style={styles.label}>H5 访问令牌</Text>
        <TextInput style={styles.input} value={token} onChangeText={setToken}
          autoCapitalize="none" secureTextEntry placeholderTextColor={C.muted}
          placeholder="粘贴 CCHH H5 访问令牌" />
      </>}
      {!!error && <Text style={styles.err}>{error}</Text>}
      {!!pairNotice && <Text style={{color:C.green,marginVertical:12,lineHeight:21}}>{pairNotice}</Text>}
      <Btn label={loading?'检查连接中…':mode==='public'?(pairing?'检查审批并连接':'申请公网手机配对'):'连接到 CCHH'} onPress={connect} disabled={loading} />
      <Text style={styles.hint}>免费非官方测试版。每位用户独立配对自己的电脑；不需要通过开发者服务器。ngrok 公网流量经第三方转发。此版本仍需真实安卓设备及群友多设备验收。</Text>
      <Text style={styles.credit}>非官方客户端 · Based on cc-haha © 2026 cc-haha</Text>
    </ScrollView>
  </SafeAreaView>;
  if(!selected) return <SafeAreaView style={styles.flex}><StatusBar style="light" />
    <View style={styles.header}><Text style={styles.title}>会话</Text><Pressable onPress={logout}><Text style={styles.actionLink}>解除配对</Text></Pressable></View>
    <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="搜索会话或项目" placeholderTextColor={C.muted} />
    {!!error && <Text style={styles.err}>{error}</Text>}
    <FlatList data={sessions.filter(s => (s.title+' '+s.projectPath).toLowerCase().includes(search.toLowerCase()))}
      keyExtractor={s=>s.id} contentContainerStyle={styles.list}
      refreshing={loading} onRefresh={() => listSessions()}
      ListEmptyComponent={<Text style={styles.muted}>暂无会话，或连接尚未完成。</Text>}
      renderItem={({item})=><Pressable style={styles.session} onPress={()=>{setError('');setSelected(item);}}>
        <Text style={styles.sessionTitle} numberOfLines={1}>{item.title||'未命名会话'}</Text>
        <Text style={styles.muted} numberOfLines={1}>{item.projectPath||item.workDir||'默认项目'}</Text>
        <Text style={styles.sessionMeta}>{item.messageCount||0} 条记录</Text>
      </Pressable>}/>
  </SafeAreaView>;
  return <SafeAreaView style={styles.flex}><StatusBar style="light" />
    <View style={styles.header}>
      <Pressable onPress={()=>{setSelected(null);setError('')}}><Text style={styles.actionLink}>‹ 会话</Text></Pressable>
      <View style={styles.headerCenter}><Text numberOfLines={1} style={styles.headerTitle}>{selected.title||'聊天'}</Text>
        <Text style={styles.mini}>{socketState}{turnBusy?' · 执行中':''}</Text></View>
      <Pressable onPress={()=>loadHistory(selected)}><Text style={styles.actionLink}>刷新</Text></Pressable>
    </View>
    {!!error && <Text style={styles.err}>{error}</Text>}
    {!!approvals.length && <View style={styles.approval}>
      <Text style={styles.approvalTitle}>需要批准 · {approvals.length} 项</Text>
      <Text style={styles.muted} numberOfLines={3}>{approvals[0].displayName||approvals[0].toolName||'工具操作'}</Text>
      <Text style={styles.mini} numberOfLines={4}>{JSON.stringify(approvals[0].input||{}).slice(0,1200)}</Text>
      <View style={styles.actions}><Btn label="拒绝" danger outline onPress={()=>decision(approvals[0],false)} /><Btn label="本次批准" onPress={()=>decision(approvals[0],true)} /></View>
    </View>}
    <FlatList ref={chatList} data={history} keyExtractor={x=>x.id}
      contentContainerStyle={styles.messages}
      onContentSizeChange={()=>{
        if(keepScroll.current) {keepScroll.current=false;return;}
        chatList.current?.scrollToEnd({animated:false});
      }}
      ListHeaderComponent={cursor?<Pressable onPress={()=>loadHistory(selected,true)}><Text style={styles.actionLink}>加载更早记录</Text></Pressable>:null}
      renderItem={({item})=><View style={[styles.bubble,item.role==='user'?styles.mine:styles.theirs]}>
        <Text style={styles.bubbleWho}>{item.pending?'你 · 待服务端确认':item.role==='user'?'你':'CCHH'}</Text>
        <MessageBody text={item.text} /></View>} />
    {!!stream && <View style={styles.streaming}><Text style={styles.mini}>正在回复…</Text><Text style={styles.bubbleText} numberOfLines={5}>{stream}</Text></View>}
    <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
      <View style={styles.composer}>
        <TextInput multiline style={styles.composeInput} placeholder="给家里的 CCHH 发送任务" placeholderTextColor={C.muted}
          autoCapitalize="none" autoCorrect={false} value={draft} onChangeText={setDraft} />
        <Btn label={turnBusy?'执行中':'发送'} disabled={turnBusy||!historyReady||!draft.trim()||socketState!=='已连接'} onPress={send} />
        {turnBusy&& <Btn label="停止" danger outline disabled={socketState!=='已连接'} onPress={()=>sendPacket({type:'stop_generation'})} />}
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Main /></SafeAreaProvider>; }

const styles=StyleSheet.create({
 flex:{flex:1,backgroundColor:C.bg},center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:C.bg},
 connect:{padding:24,paddingTop:65,paddingBottom:40},logo:{height:58,width:58,borderRadius:18,backgroundColor:C.accent,alignItems:'center',justifyContent:'center',marginBottom:22},
 logoText:{fontSize:35,fontWeight:'900',color:C.bg},h1:{fontSize:31,fontWeight:'800',color:C.text,marginBottom:7},
 label:{fontSize:14,fontWeight:'600',color:C.muted,marginTop:23,marginBottom:8},hint:{fontSize:12,lineHeight:20,color:C.muted,marginTop:30},
 guideCard:{backgroundColor:C.surface,borderWidth:1,borderColor:C.line,borderRadius:13,padding:15,marginTop:24},
 guideTitle:{fontSize:15,fontWeight:'700',color:C.text},
 guideStep:{fontSize:13,color:C.muted,lineHeight:20,marginTop:10},
 guideWarning:{fontSize:12,color:C.red,lineHeight:19,marginTop:11},
 credit:{fontSize:12,color:C.muted,marginTop:45},muted:{fontSize:13,color:C.muted},mini:{fontSize:11,color:C.muted,marginTop:3},
 input:{backgroundColor:C.surface,borderColor:C.line,borderWidth:1,borderRadius:12,padding:14,color:C.text,fontSize:15},
 btn:{backgroundColor:C.accent,borderRadius:12,paddingVertical:11,paddingHorizontal:15,alignItems:'center',justifyContent:'center',marginTop:6},
 btnOutline:{backgroundColor:C.surface2,borderWidth:1,borderColor:C.line},btnDanger:{borderColor:C.red},btnText:{color:C.bg,fontWeight:'700',fontSize:14},
 err:{fontSize:12,color:C.red,paddingHorizontal:16,paddingVertical:8},
 header:{height:62,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:17,borderBottomColor:C.line,borderBottomWidth:1},
 title:{fontSize:24,fontWeight:'800',color:C.text},headerCenter:{flex:1,marginHorizontal:13,alignItems:'center'},
 headerTitle:{color:C.text,fontSize:15,fontWeight:'700'},actionLink:{color:C.accent,fontSize:14,fontWeight:'650'},
 search:{backgroundColor:C.surface,borderRadius:11,margin:15,padding:12,color:C.text,fontSize:14},
 list:{paddingHorizontal:15,paddingBottom:30},session:{backgroundColor:C.surface,borderRadius:13,padding:16,marginBottom:10,borderWidth:1,borderColor:C.line},
 sessionTitle:{color:C.text,fontSize:16,fontWeight:'700',marginBottom:6},sessionMeta:{color:C.muted,fontSize:11,marginTop:8},
 messages:{padding:14,paddingBottom:20,flexGrow:1},bubble:{borderRadius:13,marginBottom:12,padding:13,maxWidth:'92%'},
 mine:{backgroundColor:'#3A3028',alignSelf:'flex-end'},theirs:{backgroundColor:C.surface,alignSelf:'flex-start',borderWidth:1,borderColor:C.line},
 bubbleWho:{fontSize:11,color:C.accent,marginBottom:7},bubbleText:{fontSize:14,lineHeight:21,color:C.text},
 codeText:{fontFamily:Platform.select({ios:'Menlo',android:'monospace'}),fontSize:13,lineHeight:19,color:C.text,backgroundColor:C.surface2,padding:9,borderRadius:8,marginVertical:5},
 streaming:{marginHorizontal:14,marginBottom:10,padding:12,backgroundColor:C.surface,borderRadius:12},
 composer:{flexDirection:'row',padding:10,borderTopColor:C.line,borderTopWidth:1,alignItems:'flex-end',gap:8,backgroundColor:C.bg},
 composeInput:{color:C.text,backgroundColor:C.surface,borderRadius:11,flex:1,maxHeight:110,minHeight:43,padding:11},
 approval:{padding:11,margin:12,borderRadius:13,backgroundColor:C.surface2,borderColor:C.accent,borderWidth:1},
 approvalTitle:{color:C.accent,fontWeight:'800',marginBottom:6},actions:{flexDirection:'row',justifyContent:'flex-end',gap:10,marginTop:8}
});
