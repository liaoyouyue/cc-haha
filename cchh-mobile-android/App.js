import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, FlatList, SectionList,
  KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import CookieManager from '@preeternal/react-native-cookie-manager';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { createPublicPairing, claimPublicPairing, publicSessionActive, parsePairingText } from './remotePairing.mjs';
import { parsePrivatePairingQr } from './privatePairing.mjs';
import { splitFences } from './messageText.mjs';
import { isForegroundResume, reconnectDelayMs } from './mobileRecovery.mjs';
import { endpoint } from './connectionUtils.mjs';
import { LEGAL_LINKS } from './legalLinks.mjs';
import { WORKSPACE_TABS, projectRootOf, withinProjectRoot, terminalEntriesFromHistory, safeModelChoices } from './mobileWorkbench.mjs';
import { groupSessions } from './sessionGroups.mjs';
import { toolCardsFromContent, toolCardSummary } from './toolCards.mjs';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

const STORE_KEY = 'cchh-mobile-android-connection-v1';
const C = { bg:'#FFFFFF', surface:'#F8F7FB', surface2:'#EFEDF5', line:'#EAE7EF',
  text:'#17161D', muted:'#787680', accent:'#9981C4', green:'#23845A', red:'#C53D49' };
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
// Explicit model/effort changes affect the paired desktop's defaults.
async function putJson(config, path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(config.baseUrl + path, {
      method:'PUT',
      headers:config.mode === 'public'
        ? {Origin:config.baseUrl,Accept:'application/json','Content-Type':'application/json'}
        : {Authorization:'Bearer ' + config.token,'Content-Type':'application/json'},
      credentials:config.mode === 'public' ? 'include' : 'omit',
      body:JSON.stringify(body),signal:ctl.signal
    });
    if(!res.ok) throw new Error('CCHH 不允许更新此设置（HTTP ' + res.status + '）');
    return await res.json();
  } finally {clearTimeout(timer);}
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
      timestamp: m.timestamp || '',
      toolCards: m.type === 'assistant' ? toolCardsFromContent(m.content) : []
    })).filter(m => m.text || (m.toolCards && m.toolCards.length));
}
function MessageBody({text}) {
  return splitFences(text).map((part,index) => <Text key={index} selectable
    style={part.code?styles.codeText:styles.bubbleText}>{part.text}</Text>);
}
function ToolCard({card, open, onToggle}) {
  const brief = toolCardSummary(card);
  return <Pressable accessibilityRole="button" onPress={onToggle}
    style={[styles.toolCard, card.isError && styles.toolCardError]}>
    <Text style={[styles.toolCardTitle, card.isError && {color:C.red}]} numberOfLines={open?4:2}>
      {open?'▼ ':'▶ '}{(card.isError?'⚠ ':'')}{brief}
    </Text>
    {open && <>
      <Text style={styles.toolDetailLabel}>参数</Text>
      <Text style={styles.toolDetail} selectable>{JSON.stringify(card.input||{},null,2)}</Text>
      {!!card.output && <>
        <Text style={styles.toolDetailLabel}>{card.isError?'错误输出':'输出'}</Text>
        <Text style={[styles.toolDetail, card.isError && {color:C.red}]} selectable>{card.output}</Text>
      </>}
    </>}
  </Pressable>;
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
  const [showGuide, setShowGuide] = useState(false);
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
  const [showAbout, setShowAbout] = useState(false);
  const [draft, setDraft] = useState('');
  const [socketState, setSocketState] = useState('未连接');
  const [stream, setStream] = useState('');
  const [turnBusy, setTurnBusy] = useState(false);
  const [approvals, setApprovals] = useState([]);
  const [search, setSearch] = useState('');
  const [expandedTools, setExpandedTools] = useState({});
  const [tab, setTab] = useState('chat');
  const [queued, setQueued] = useState([]); // unsent local drafts, never replay automatically
  const [terminalEvents, setTerminalEvents] = useState([]);
  const [taskItems, setTaskItems] = useState([]);
  const [taskError, setTaskError] = useState('');
  const [taskLoading, setTaskLoading] = useState(false);
  const [modelInfo, setModelInfo] = useState(null);
  const [modelChoices, setModelChoices] = useState([]);
  const [modelPicker, setModelPicker] = useState(false);
  const [effortInfo, setEffortInfo] = useState(null);
  const [effortPicker, setEffortPicker] = useState(false);
  const [filesDir, setFilesDir] = useState('');
  const [fileEntries, setFileEntries] = useState([]);
  const [filesError, setFilesError] = useState('');
  const [filesLoading, setFilesLoading] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState(null);
  const [desktopError, setDesktopError] = useState('');
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const pingRef = useRef(null);
  const pongRef = useRef(null);
  const sendLock = useRef(false);
  const selectedId = useRef(null);
  const browseSeq = useRef(0);
  const taskSeq = useRef(0);
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
      setQueued([]);setTerminalEvents([]);setFileEntries([]);setFilesDir('');
      setTaskItems([]);setTaskError('');browseSeq.current++;taskSeq.current++;
      setModelInfo(null);setModelChoices([]);setEffortInfo(null);
      setDesktopInfo(null);setDesktopError('');setTab('chat');
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
      const observedTools = terminalEntriesFromHistory(payload);
      setTerminalEvents(prev => older
        ? [...observedTools.filter(v=>!prev.some(x=>x.id === v.id)), ...prev].slice(-60)
        : observedTools);
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
    setHistory([]); setHistoryReady(false); setCursor(null); setApprovals([]); setStream('');
    setTerminalEvents([]); setModelPicker(false); setEffortPicker(false); setModelInfo(null); setEffortInfo(null);
    setTaskItems([]);setTaskError('');keepScroll.current=false;
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
      if(selected && tab !== 'chat') { setTab('chat'); return true; }
      if(selected) { setSelected(null); setError(''); setExpandedTools({}); return true; }
      return false;
    });
    return () => handler.remove();
  },[selected,tab]);

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

  const activeQueue = queued.filter(item => item.sessionId === selected?.id);
  function addToQueue() {
    const value=draft.trim();
    if(!selected || !value) return;
    setQueued(prev=>[...prev,{id:'q-'+Date.now()+'-'+Math.random(),sessionId:selected.id,text:value}]);
    setDraft('');
  }
  function moveQueueToComposer(item) {
    if(draft.trim()) {Alert.alert('输入框里还有内容','先发送或保存当前文字，再选择队列内容。');return;}
    setDraft(item.text);
    setQueued(prev=>prev.filter(x=>x.id!==item.id));
    setTab('chat');
  }
  useEffect(()=>{
    if(!config || !selected) return;
    let active=true;
    Promise.allSettled([getJson(config,'/api/models/current'),getJson(config,'/api/effort')])
      .then(([m,e])=>{
        if(!active)return;
        setModelInfo(m.status==='fulfilled'?m.value.model:null);
        setEffortInfo(e.status==='fulfilled'?e.value:null);
      });
    return ()=>{active=false;};
  },[config,selected?.id]);
  async function openModelPicker() {
    setEffortPicker(false);
    if(modelPicker){setModelPicker(false);return;}
    try {
      const data=await getJson(config,'/api/models');
      setModelChoices(safeModelChoices(data));setModelPicker(true);
    } catch(e){setError('无法读取电脑模型列表：'+(e.message||'不支持'));}
  }
  function changeDefaultModel(item) {
    if(turnBusy){Alert.alert('任务执行中','请等待当前任务完成再切换模型。');return;}
    Alert.alert('切换电脑默认模型','这会修改当前配对电脑的 CCHH 默认模型，并非仅修改手机显示。',[{text:'取消',style:'cancel'},
      {text:'确认切换',onPress:async()=>{
        try{await putJson(config,'/api/models/current',{modelId:item.id});
          setModelInfo({id:item.id,name:item.name});setModelPicker(false);setError('');}
        catch(e){setError(e.message||'模型切换失败');}
      }}]);
  }
  function changeEffort(level) {
    if(turnBusy){Alert.alert('任务执行中','请等待当前任务完成再修改思考等级。');return;}
    Alert.alert('修改思考等级','将更改当前电脑 CCHH 的默认思考设置。',[{text:'取消',style:'cancel'},
      {text:'确认',onPress:async()=>{
        try{await putJson(config,'/api/effort',{level});setEffortInfo(prev=>({...prev,level}));setEffortPicker(false);setError('');}
        catch(e){setError(e.message||'思考等级设置失败');}
      }}]);
  }
  async function browseFiles(requestPath) {
    const activeId=selected?.id;
    const seq=++browseSeq.current;
    const root=projectRootOf(selected);
    if(!root){setFilesError('当前会话没有可用的项目路径');setFileEntries([]);return;}
    if(!withinProjectRoot(root,requestPath)){setFilesError('只能浏览当前会话的项目目录');return;}
    setFilesLoading(true);setFilesError('');
    setFileEntries([]);setFilesDir(requestPath);
    try{
      const data=await getJson(config,'/api/filesystem/browse?path='+encodeURIComponent(requestPath)+'&includeFiles=true&maxResults=100');
      if(browseSeq.current!==seq || selectedId.current!==activeId)return;
      if(!withinProjectRoot(root,data.currentPath||requestPath))throw new Error('服务器返回了项目以外的路径');
      setFilesDir(data.currentPath||requestPath);
      setFileEntries((data.entries||[]).filter(x=>withinProjectRoot(root,x.path)));
    }catch(e){if(browseSeq.current===seq && selectedId.current===activeId){setFilesError(e.message||'文件浏览不可用');setFileEntries([]);}}
    finally{if(browseSeq.current===seq && selectedId.current===activeId)setFilesLoading(false);}
  }
  async function loadTaskItems(){
    if(!selected?.id || !config)return;
    const sessionId=selected.id,seq=++taskSeq.current;
    setTaskLoading(true);setTaskError('');
    try{
      // Restrict listing to the selected session rather than exposing other
      // sessions' or unrelated terminated teams' task registers.
      const data=await getJson(config,'/api/tasks/lists/'+encodeURIComponent(sessionId));
      if(taskSeq.current!==seq || selectedId.current!==sessionId)return;
      const list=Array.isArray(data.tasks)?data.tasks:[];
      setTaskItems(list.filter(item=>item && item.taskListId===sessionId &&
        ['pending','in_progress','completed'].includes(item.status)));
    }catch(e){if(taskSeq.current===seq&&selectedId.current===sessionId){setTaskItems([]);setTaskError(e.message||'任务列表不可用');}}
    finally{if(taskSeq.current===seq&&selectedId.current===sessionId)setTaskLoading(false);}
  }
  async function refreshDesktop(){
    setDesktopError('');
    try{setDesktopInfo(await getJson(config,'/api/status'));}
    catch(e){setDesktopInfo(null);setDesktopError(e.message||'无法读取电脑服务状态');}
  }
  function changeTab(next) {
    setTab(next);setModelPicker(false);setEffortPicker(false);
    if(next==='tasks')void loadTaskItems();
    if(next==='files')void browseFiles(projectRootOf(selected));
    if(next==='desktop')void refreshDesktop();
  }

  function openLegal(url) {
    Linking.openURL(url).catch(() => Alert.alert('无法打开链接', url));
  }

  if(restoring) return <View style={styles.center}><ActivityIndicator color={C.accent} /></View>;
  if(showAbout) return <SafeAreaView style={styles.flex}><StatusBar style="dark" />
    <View style={styles.header}>
      <Text style={styles.title}>关于 / 法律</Text>
      <Pressable accessibilityRole="button" onPress={()=>setShowAbout(false)}><Text style={styles.actionLink}>关闭</Text></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.aboutContent}>
      <Text style={styles.aboutTitle}>CCHH Mobile</Text>
      <Text style={styles.aboutText}>版本 0.1.5 (Build 1)</Text>
      <Text style={styles.aboutText}>包名: com.cchh.mobile.client</Text>
      <Text style={styles.aboutText}>基于 CCHH v0.7.4</Text>
      <Text style={styles.aboutText}>非官方客户端，不代表上游认可或背书。</Text>
      <View style={styles.aboutSection}>
        <Text style={styles.aboutSectionTitle}>源码与许可证</Text>
        <Text style={styles.aboutText}>Based on cc-haha: https://github.com/NanmiCoder/cc-haha</Text>
        <Text style={styles.aboutText}>Copyright (c) 2026 cc-haha</Text>
        <Pressable accessibilityRole="link" onPress={()=>openLegal(LEGAL_LINKS.upstreamLicense)}><Text style={styles.legalLink}>打开上游许可证</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={()=>openLegal(LEGAL_LINKS.source)}><Text style={styles.legalLink}>打开本客户端源码</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={()=>openLegal(LEGAL_LINKS.thirdPartyNotices)}><Text style={styles.legalLink}>打开第三方声明</Text></Pressable>
      </View>
      <View style={styles.aboutSection}>
        <Text style={styles.aboutSectionTitle}>免责声明</Text>
        <Text style={styles.aboutText}>非官方、非商业测试版，不保证稳定性。</Text>
        <Text style={styles.aboutText}>每位用户独立连接自己的 CCHH；不提供集中账号或开发者代理。</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
  if(!config) return <SafeAreaView style={styles.flex}><StatusBar style="dark" />
    <ScrollView contentContainerStyle={styles.connect}>
      <View style={styles.logo}><Text style={styles.logoText}>C</Text></View>
      <Text style={styles.h1}>连接自己的 CCHH</Text>
      <Text style={styles.connectLead}>扫码配对自己的电脑 · 无需共享账号或 API 密钥</Text>
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
      <Text style={styles.label}>选择连接方式</Text>
      <View style={{flexDirection:'row',gap:8}}>
        <View style={{flex:1}}><Btn label="同一 Wi-Fi" outline={networkType!=='lan'} onPress={()=>chooseConnection('lan')} /></View>
        <View style={{flex:1}}><Btn label="Tailscale" outline={networkType!=='tailscale'} onPress={()=>chooseConnection('tailscale')} /></View>
      </View>
      <Btn label="公网 ngrok（实验性）" outline={networkType!=='public'} onPress={()=>chooseConnection('public')} />
      <Text style={styles.guideStep}>{mode==='public'
        ? '电脑打开「H5 访问 → 公网 ngrok」，使用自己的免费账户开通后生成公网配对二维码。'
        : networkType==='tailscale'
          ? '先让手机和电脑加入自己的 Tailscale 网络；扫码读取 H5 令牌后，确认地址是电脑的 100.x 私网地址。'
          : '手机和电脑连接同一个可信 Wi-Fi，然后扫描自己电脑「H5 访问」中的二维码。'}</Text>
      <View style={styles.primaryScan}><Btn label={mode==='public'?'扫码申请公网配对':'扫码连接电脑  ↗'} onPress={()=>startQrScan(mode==='public'?'public':'private')} /></View>
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
      <Pressable accessibilityRole="button" onPress={()=>setShowAbout(true)}><Text style={styles.legalLink}>关于 / 法律</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;

  if(!selected) return <SafeAreaView style={styles.flex}><StatusBar style="dark" />
    <View style={styles.header}>
      <Text style={styles.title}>CCHH Mobile</Text>
      <View style={styles.headerActions}>
        <Pressable accessibilityRole="button" onPress={()=>setShowAbout(true)}><Text style={styles.actionLink}>关于</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={logout}><Text style={styles.actionLink}>解除配对</Text></Pressable>
      </View>
    </View>
    <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="搜索会话或项目" placeholderTextColor={C.muted} />
    {!!error && <Text style={styles.err}>{error}</Text>}
    <SectionList
      sections={groupSessions(sessions, { search }).map(g => ({
        key: g.key, title: g.label,
        data: g.sessions.map(s => ({...s, __hot: g.key === 'attention'}))
      }))}
      keyExtractor={s=>s.id} contentContainerStyle={styles.list}
      refreshing={loading} onRefresh={() => listSessions()}
      ListEmptyComponent={<Text style={styles.muted}>暂无会话，请在电脑 CCHH 中创建或打开会话。</Text>}
      renderSectionHeader={({section}) => <Text style={styles.sectionHeader}>{section.title}</Text>}
      renderItem={({item})=><Pressable style={[styles.session, item.__hot && styles.sessionHot]} onPress={()=>{setError('');setTab('chat');setSelected(item);}}>
        <Text style={styles.sessionTitle} numberOfLines={1}>{item.title||'未命名会话'}</Text>
        <Text style={styles.muted} numberOfLines={1}>{projectRootOf(item)||'默认项目'}</Text>
        <Text style={styles.sessionMeta}>{item.messageCount||0} 条记录{item.__hot?' · 需要你':''}</Text>
      </Pressable>}/>
  </SafeAreaView>;

  return <SafeAreaView style={styles.flex}><StatusBar style="dark" />
    <View style={styles.workbenchHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="切换会话" style={styles.avatarCircle}
        onPress={()=>{setSelected(null);setTab('chat');setError('');}}>
        <Text style={styles.avatarText}>C</Text>
      </Pressable>
      <View style={styles.workbenchHeading}>
        <Text style={styles.workbenchTitle}>CCHH Mobile</Text>
        <Text style={styles.workbenchSubtitle} numberOfLines={1}>{selected.title||'当前会话'} · {socketState}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="历史会话" style={styles.historyButton}
        onPress={()=>{setSelected(null);setTab('chat');setError('');}}>
        <Text style={styles.historyGlyph}>◷</Text>
      </Pressable>
    </View>
    {!!error && <Pressable accessibilityRole="button" onPress={()=>setError('')} style={styles.errorBar}>
      <Text style={styles.err}>{error} · 点击关闭</Text>
    </Pressable>}
    {tab==='tasks' && approvals.length>0 && <View style={styles.approval}>
      <Text style={styles.approvalTitle}>等待你的批准 · {approvals.length}</Text>
      <Text style={styles.muted} numberOfLines={3}>{approvals[0].displayName||approvals[0].toolName||'工具操作'}</Text>
      <Text style={styles.mini} numberOfLines={3}>{JSON.stringify(approvals[0].input||{}).slice(0,700)}</Text>
      <View style={styles.actions}><Btn label="拒绝" danger outline onPress={()=>decision(approvals[0],false)} />
        <Btn label="本次批准" onPress={()=>decision(approvals[0],true)} /></View>
    </View>}

    {tab==='chat' && <>
      <FlatList ref={chatList} data={history} keyExtractor={x=>x.id}
        contentContainerStyle={styles.messages}
        onContentSizeChange={()=>{
        if(keepScroll.current){keepScroll.current=false;return;}
        chatList.current?.scrollToEnd({animated:false});
      }}
        ListEmptyComponent={<View style={styles.emptyChat}><Text style={styles.emptyTitle}>继续你的 CCHH 任务</Text>
          <Text style={styles.muted}>手机上的消息会发送到当前已配对电脑。</Text></View>}
        ListHeaderComponent={cursor?<Pressable onPress={()=>loadHistory(selected,true)}><Text style={styles.actionLink}>加载更早记录</Text></Pressable>:null}
        renderItem={({item})=><View style={[styles.bubble,item.role==='user'?styles.mine:styles.theirs]}>
          <Text style={styles.bubbleWho}>{item.pending?'你 · 等待服务端确认':item.role==='user'?'你':'CCHH'}</Text>
          <MessageBody text={item.text} />
          {!!(item.toolCards||[]).length && item.toolCards.map(card =>
            <ToolCard key={card.toolUseId} card={card}
              open={!!expandedTools[card.toolUseId]}
              onToggle={()=>setExpandedTools(prev=>({...prev,[card.toolUseId]:!prev[card.toolUseId]}))} />)}</View>} />
      {!!stream && <View style={styles.streaming}><Text style={styles.mini}>● 正在思考与回复…</Text>
        <Text style={styles.bubbleText} numberOfLines={6}>{stream}</Text></View>}
      {turnBusy && !stream && <Text style={styles.runningHint}>◌  CCHH 正在执行任务…</Text>}
      {activeQueue.length>0 && <View style={styles.queueCard}>
        <Text style={styles.queueTitle}>消息队列 · 本机待发送 {activeQueue.length}</Text>
        {activeQueue.slice(0,3).map((item,i)=><View key={item.id} style={styles.queueItem}>
          <Text style={styles.queueItemText} numberOfLines={1}>{i+1}. {item.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="取出待发送消息" onPress={()=>moveQueueToComposer(item)}><Text style={styles.queueAction}>↑</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="删除待发送消息" onPress={()=>setQueued(q=>q.filter(x=>x.id!==item.id))}><Text style={styles.queueDelete}>×</Text></Pressable>
        </View>)}
        <Text style={styles.mini}>队列只保存在当前运行的手机界面，取出后需再次确认发送；不会自动执行。</Text>
      </View>}
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
        {tab==='chat' && approvals.length>0 && <View style={styles.approvalDock}>
          <Text style={styles.approvalTitle}>需要批准 · {approvals.length} 项</Text>
          <Text style={styles.muted} numberOfLines={2}>{approvals[0].displayName||approvals[0].toolName||'工具操作'}</Text>
          <Text style={styles.mini} numberOfLines={3}>{JSON.stringify(approvals[0].input||{}).slice(0,700)}</Text>
          <View style={styles.actions}><Btn label="拒绝" danger outline onPress={()=>decision(approvals[0],false)} />
            <Btn label="本次批准" onPress={()=>decision(approvals[0],true)} /></View>
        </View>}
        <View style={styles.modelLine}>
          <Pressable accessibilityRole="button" onPress={()=>void openModelPicker()} style={styles.modelChip}>
            <Text style={styles.modelText} numberOfLines={1}>{modelInfo?.name||'电脑模型不可读'}  ⌄</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={()=>{setModelPicker(false);setEffortPicker(v=>!v);}} style={styles.effortChip}>
            <Text style={styles.modelText}>思考：{effortInfo?.level||'未读取'} ⌄</Text>
          </Pressable>
        </View>
        {modelPicker && <ScrollView style={styles.settingPicker} nestedScrollEnabled>
          <Text style={styles.settingTitle}>电脑默认模型 · 点击后需确认</Text>
          {modelChoices.map(m=><Pressable key={m.id} style={styles.settingItem} onPress={()=>changeDefaultModel(m)}>
            <Text style={styles.settingText}>{m.name}</Text><Text style={styles.mini}>{m.id}</Text>
          </Pressable>)}
        </ScrollView>}
        {effortPicker && <View style={styles.settingPicker}>
          <Text style={styles.settingTitle}>思考等级 · 将影响电脑默认配置</Text>
          <View style={styles.effortChoices}>{(effortInfo?.available||[]).map(level=>
            <Pressable key={level} style={styles.effortOption} onPress={()=>changeEffort(level)}><Text style={styles.settingText}>{level}</Text></Pressable>)}</View>
          {(!effortInfo?.available?.length) && <Text style={styles.muted}>当前连接无法读取可用等级</Text>}
        </View>}
        <View style={styles.composer}>
          <Pressable accessibilityRole="button" accessibilityLabel="加入本机待发送队列" disabled={!draft.trim()} onPress={addToQueue}
            style={styles.queuePlus}><Text style={styles.plusText}>＋</Text></Pressable>
          <TextInput multiline style={styles.composeInput} placeholder="发消息…" placeholderTextColor={C.muted}
            autoCapitalize="none" autoCorrect={false} value={draft} onChangeText={setDraft}/>
          {turnBusy
            ? <Pressable accessibilityRole="button" accessibilityLabel="停止生成" style={styles.sendButton}
                disabled={socketState!=='已连接'} onPress={()=>sendPacket({type:'stop_generation'})}><Text style={styles.sendText}>■</Text></Pressable>
            : <Pressable accessibilityRole="button" accessibilityLabel="发送消息" style={styles.sendButton}
                disabled={!historyReady||!draft.trim()||socketState!=='已连接'} onPress={send}><Text style={styles.sendText}>↑</Text></Pressable>}
        </View>
      </KeyboardAvoidingView>
    </>}

    {tab==='tasks' && <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent}>
      <Text style={styles.panelTitle}>任务</Text>
      <Text style={styles.panelSubtitle}>当前会话的实时状态、待审批任务和真实任务清单</Text>
      <View style={styles.infoCard}><Text style={styles.cardHeading}>当前执行</Text>
        <Text style={styles.stateBig}>{turnBusy?'● 正在执行':socketState==='已连接'?'✓ 等待新指令':'◌ '+socketState}</Text>
        <Text style={styles.muted}>待审批 {approvals.length} 项 · 本机待发送 {activeQueue.length} 条</Text>
        {turnBusy && <Btn label="停止当前生成" danger outline disabled={socketState!=='已连接'}
          onPress={()=>sendPacket({type:'stop_generation'})}/>}
      </View>
      <View style={styles.taskSectionHeader}><Text style={styles.cardHeading}>当前会话任务清单</Text>
        <Pressable accessibilityRole="button" onPress={()=>void loadTaskItems()}><Text style={styles.actionLink}>{taskLoading?'加载中':'刷新'}</Text></Pressable></View>
      {!!taskError && <Text style={styles.err}>{taskError}</Text>}
      {taskItems.map(t=><View key={t.taskListId+'-'+t.id} style={styles.infoCard}>
        <Text style={styles.taskText}>{t.status==='completed'?'✓ ':t.status==='in_progress'?'● ':'○ '}{t.subject||'未命名任务'}</Text>
        <Text style={styles.muted}>{t.status==='completed'?'已完成':t.status==='in_progress'?'执行中':'等待执行'}{t.owner?' · '+t.owner:''}</Text>
        {!!t.description && <Text style={styles.mini} numberOfLines={4}>{t.description}</Text>}
      </View>)}
      {!taskLoading&&!taskItems.length&&!taskError&&<Text style={styles.muted}>当前会话尚无独立任务清单，下面显示聊天指令记录。</Text>}
      <Text style={styles.cardHeading}>最近发送的指令</Text>
      {history.filter(m=>m.role==='user'&&!m.pending).slice(-12).reverse().map(m=>
        <View key={m.id} style={styles.infoCard}><Text style={styles.taskText} numberOfLines={5}>{m.text}</Text>
          <Text style={styles.mini}>{m.timestamp||'已记录在 CCHH 会话历史'}</Text></View>)}
      {!history.some(m=>m.role==='user') && <Text style={styles.muted}>这段会话暂无已记录的指令。</Text>}
    </ScrollView>}

    {tab==='terminal' && <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent}>
      <Text style={styles.panelTitle}>终端</Text>
      <Text style={styles.panelSubtitle}>来自电脑 CCHH 会话的真实命令与输出 · 只读</Text>
      {terminalEvents.map((ev,i)=><View key={ev.id+'-'+i} style={styles.terminalCard}>
        <Text style={styles.terminalLabel}>{ev.kind==='command'?'$ '+ev.label:'↳ '+ev.label}</Text>
        <Text selectable style={styles.terminalText}>{ev.text}</Text>
      </View>)}
      {terminalEvents.length===0 && <View style={styles.infoCard}><Text style={styles.muted}>
        当前已加载历史中没有可识别的终端调用。这里不会伪造终端画面，也不会直接执行电脑命令。
      </Text></View>}
    </ScrollView>}

    {tab==='files' && <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent}>
      <Text style={styles.panelTitle}>文件</Text>
      <Text style={styles.panelSubtitle}>仅浏览当前项目，路径由电脑 CCHH 接口返回</Text>
      <View style={styles.infoCard}>
        <Text selectable style={styles.pathText}>{filesDir||projectRootOf(selected)||'当前会话未提供项目路径'}</Text>
        <View style={styles.fileActions}>
          {withinProjectRoot(projectRootOf(selected),filesDir)&&filesDir!==projectRootOf(selected)&&
            <Btn label="上一级" outline onPress={()=>{const sep=filesDir.includes('\\')?'\\':'/';
              const parent=filesDir.slice(0,filesDir.lastIndexOf(sep));
              if(withinProjectRoot(projectRootOf(selected),parent))void browseFiles(parent);}}/>}
          <Btn label={filesLoading?'加载中…':'刷新文件'} outline onPress={()=>void browseFiles(filesDir||projectRootOf(selected))}/>
        </View>
        {!!filesError && <Text style={styles.err}>{filesError}</Text>}
      </View>
      {fileEntries.map(item=><Pressable key={item.path} accessibilityRole="button" style={styles.fileItem}
        onPress={()=>item.isDirectory ? void browseFiles(item.path)
          : Alert.alert('项目文件',item.name+'\n当前版本支持安全浏览；普通文件编辑和读取待核实 CCHH 接口。')}>
        <Text style={styles.fileGlyph}>{item.isDirectory?'▣':'▤'}</Text>
        <Text style={styles.fileName} numberOfLines={1}>{item.name}</Text>
        {item.isDirectory&&<Text style={styles.muted}>›</Text>}
      </Pressable>)}
      {fileEntries.length===0&&!filesLoading&&!filesError && <Text style={styles.muted}>目录里暂无可展示的文件。</Text>}
    </ScrollView>}

    {tab==='desktop' && <ScrollView style={styles.panelScroll} contentContainerStyle={styles.panelContent}>
      <Text style={styles.panelTitle}>桌面</Text>
      <Text style={styles.panelSubtitle}>你自己电脑的 CCHH 连接状态</Text>
      <View style={styles.infoCard}><Text style={styles.cardHeading}>电脑连接</Text>
        <Text style={styles.stateBig}>{desktopInfo?.status==='ok'?'● 服务在线':'◌ 状态待确认'}</Text>
        <Text style={styles.detailText}>连接地址：{config.baseUrl}</Text>
        <Text style={styles.detailText}>连接模式：{config.mode==='public'?'公网 HTTPS':'私人网络'}</Text>
        <Text style={styles.detailText}>服务版本：{desktopInfo?.version||'未读取'}</Text>
        <Text style={styles.detailText}>当前项目：{projectRootOf(selected)||'未提供'}</Text>
        {!!desktopError && <Text style={styles.err}>{desktopError}</Text>}
        <Btn label="刷新电脑状态" outline onPress={()=>void refreshDesktop()}/>
      </View>
      <View style={styles.infoCard}><Text style={styles.cardHeading}>远程桌面画面</Text>
        <Text style={styles.muted}>当前 CCHH Mobile 尚未实现真实桌面视频与控制协议，因此不展示虚假的电脑桌面。已有聊天、审批和文件浏览可继续使用。</Text>
        <Btn label="返回聊天" outline onPress={()=>changeTab('chat')}/>
      </View>
    </ScrollView>}

    <View style={styles.tabbar}>
      {WORKSPACE_TABS.map(t=><Pressable key={t.id} accessibilityRole="tab" accessibilityState={{selected:tab===t.id}}
        onPress={()=>changeTab(t.id)} style={styles.tabItem}>
        <Text style={[styles.tabGlyph,tab===t.id&&styles.tabActive]}>{t.symbol}</Text>
        <Text style={[styles.tabLabel,tab===t.id&&styles.tabActive]}>{t.label}</Text>
        {tab===t.id&&<View style={styles.tabUnderline}/>}
      </Pressable>)}
    </View>
  </SafeAreaView>;
}
export default function App() { return <SafeAreaProvider><Main /></SafeAreaProvider>; }

const styles=StyleSheet.create({
 flex:{flex:1,backgroundColor:C.bg},center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:C.bg},
 connect:{padding:22,paddingTop:26,paddingBottom:35},logo:{height:47,width:47,borderRadius:15,backgroundColor:C.accent,alignItems:'center',justifyContent:'center',marginBottom:17},
 logoText:{fontSize:29,fontWeight:'900',color:'#FFFFFF'},h1:{fontSize:28,fontWeight:'800',color:C.text,marginBottom:6},connectLead:{fontSize:14,color:C.muted,lineHeight:23,marginBottom:10},primaryScan:{marginTop:13},
 label:{fontSize:14,fontWeight:'600',color:C.muted,marginTop:17,marginBottom:8},hint:{fontSize:12,lineHeight:20,color:C.muted,marginTop:30},
 guideCard:{backgroundColor:C.surface,borderWidth:1,borderColor:C.line,borderRadius:13,padding:13,marginTop:16},
 guideTitle:{fontSize:15,fontWeight:'700',color:C.text},
 guideStep:{fontSize:13,color:C.muted,lineHeight:20,marginTop:10},
 guideWarning:{fontSize:12,color:C.red,lineHeight:19,marginTop:11},
 credit:{fontSize:12,color:C.muted,marginTop:45},muted:{fontSize:13,color:C.muted},mini:{fontSize:11,color:C.muted,marginTop:3},
 input:{backgroundColor:C.surface,borderColor:C.line,borderWidth:1,borderRadius:12,padding:14,color:C.text,fontSize:15},
 btn:{backgroundColor:C.accent,borderRadius:12,paddingVertical:11,paddingHorizontal:15,alignItems:'center',justifyContent:'center',marginTop:6},
 btnOutline:{backgroundColor:C.surface2,borderWidth:1,borderColor:C.line},btnDanger:{borderColor:C.red},btnText:{color:'#221B2E',fontWeight:'700',fontSize:14},
 err:{fontSize:12,color:C.red,paddingHorizontal:16,paddingVertical:8},
 header:{height:62,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:17,borderBottomColor:C.line,borderBottomWidth:1},
 title:{fontSize:24,fontWeight:'800',color:C.text},headerCenter:{flex:1,marginHorizontal:13,alignItems:'center'},
 headerTitle:{color:C.text,fontSize:15,fontWeight:'700'},actionLink:{color:C.accent,fontSize:14,fontWeight:'650'},
 search:{backgroundColor:C.surface,borderRadius:11,margin:15,padding:12,color:C.text,fontSize:14},
 list:{paddingHorizontal:15,paddingBottom:30},session:{backgroundColor:C.surface,borderRadius:13,padding:16,marginBottom:10,borderWidth:1,borderColor:C.line},
 sessionTitle:{color:C.text,fontSize:16,fontWeight:'700',marginBottom:6},sessionMeta:{color:C.muted,fontSize:11,marginTop:8},
 messages:{padding:18,paddingBottom:20,flexGrow:1},bubble:{borderRadius:13,marginBottom:12,padding:13,maxWidth:'92%'},
 mine:{backgroundColor:'#F0ECF7',alignSelf:'flex-end'},theirs:{backgroundColor:C.bg,alignSelf:'flex-start',borderWidth:0,borderColor:C.line,maxWidth:'100%'},
 bubbleWho:{fontSize:11,color:C.accent,marginBottom:7},bubbleText:{fontSize:16,lineHeight:26,color:C.text},
 codeText:{fontFamily:Platform.select({ios:'Menlo',android:'monospace'}),fontSize:13,lineHeight:19,color:C.text,backgroundColor:C.surface2,padding:9,borderRadius:8,marginVertical:5},
 streaming:{marginHorizontal:14,marginBottom:10,padding:12,backgroundColor:C.surface,borderRadius:12},
 composer:{flexDirection:'row',paddingHorizontal:11,paddingBottom:10,paddingTop:5,alignItems:'flex-end',gap:8,backgroundColor:C.bg},
 composeInput:{color:C.text,backgroundColor:'#F5F2F9',borderRadius:17,flex:1,maxHeight:140,minHeight:48,paddingHorizontal:15,paddingVertical:12,fontSize:16},
 approval:{padding:11,margin:12,borderRadius:13,backgroundColor:C.surface2,borderColor:C.accent,borderWidth:1},
 approvalTitle:{color:C.accent,fontWeight:'800',marginBottom:6},actions:{flexDirection:'row',justifyContent:'flex-end',gap:10,marginTop:8},
 headerActions:{flexDirection:'row',alignItems:'center',gap:16},
 aboutContent:{padding:24,paddingBottom:48},aboutTitle:{fontSize:27,fontWeight:'800',color:C.text,marginBottom:18},
 aboutText:{fontSize:13,lineHeight:21,color:C.muted,marginBottom:5},aboutSection:{marginTop:22},
 aboutSectionTitle:{fontSize:16,fontWeight:'700',color:C.text,marginBottom:9},legalLink:{fontSize:14,lineHeight:22,color:C.accent,marginTop:9,textDecorationLine:'underline'},

  workbenchHeader:{height:76,flexDirection:'row',alignItems:'center',borderBottomColor:C.line,borderBottomWidth:1,paddingHorizontal:18,backgroundColor:C.bg},
  avatarCircle:{height:42,width:42,borderRadius:22,backgroundColor:'#E5DCF4',alignItems:'center',justifyContent:'center'},
  avatarText:{fontSize:22,fontWeight:'900',color:'#7859B3'},
  workbenchHeading:{flex:1,alignItems:'center',paddingHorizontal:8},
  workbenchTitle:{fontSize:25,color:C.text,fontWeight:'800',letterSpacing:-0.6},
  workbenchSubtitle:{fontSize:10,color:C.muted,marginTop:2,maxWidth:'90%'},
  historyButton:{width:42,height:42,alignItems:'center',justifyContent:'center'},
  historyGlyph:{fontSize:32,color:C.text},
  errorBar:{backgroundColor:'#FFF0F2',marginHorizontal:10,borderRadius:8,marginVertical:5},
  emptyChat:{padding:28,justifyContent:'center',alignItems:'center',minHeight:180},
  emptyTitle:{fontSize:21,color:C.text,fontWeight:'700',marginBottom:9},
  runningHint:{color:C.muted,fontSize:13,paddingHorizontal:22,paddingVertical:10},
  queueCard:{marginHorizontal:12,marginBottom:5,padding:11,borderRadius:16,backgroundColor:'#F6F2FA'},
  queueTitle:{fontSize:13,fontWeight:'700',color:'#615A6D',marginBottom:8},
  queueItem:{flexDirection:'row',alignItems:'center',gap:9,paddingVertical:9,borderTopWidth:1,borderColor:'#EAE5F0'},
  queueItemText:{color:C.text,flex:1,fontSize:13},queueAction:{color:C.accent,fontSize:24,paddingHorizontal:8},
  queueDelete:{color:C.red,fontSize:25,paddingHorizontal:8},
  modelLine:{flexDirection:'row',alignItems:'center',paddingHorizontal:14,paddingVertical:7,gap:10},
  modelChip:{maxWidth:'55%',paddingHorizontal:11,paddingVertical:7,borderRadius:18,backgroundColor:'#F8F7FB'},
  effortChip:{paddingHorizontal:8,paddingVertical:7},modelText:{fontSize:13,color:'#686370'},
  settingPicker:{maxHeight:230,backgroundColor:C.bg,borderTopColor:C.line,borderTopWidth:1,padding:10},
  settingTitle:{color:C.muted,fontSize:12,fontWeight:'700',marginBottom:8},
  settingItem:{paddingVertical:10,borderBottomWidth:1,borderColor:C.line},
  settingText:{color:C.text,fontSize:14,fontWeight:'600'},
  effortChoices:{flexDirection:'row',flexWrap:'wrap',gap:8},
  effortOption:{padding:8,backgroundColor:C.surface,borderRadius:10},
  queuePlus:{height:44,width:43,alignItems:'center',justifyContent:'center'},
  plusText:{fontSize:31,fontWeight:'300',color:'#67646C'},
  sendButton:{width:48,height:48,borderRadius:16,backgroundColor:C.accent,alignItems:'center',justifyContent:'center'},
  sendText:{fontSize:24,fontWeight:'700',color:'#241D31'},
  tabbar:{height:67,flexDirection:'row',borderTopWidth:1,borderTopColor:C.line,backgroundColor:C.bg},
  tabItem:{flex:1,alignItems:'center',justifyContent:'center',gap:3},
  tabGlyph:{fontSize:24,color:'#5E5B62'},tabLabel:{fontSize:11,color:'#66626B'},
  tabActive:{color:'#7960A6',fontWeight:'700'},
  tabUnderline:{position:'absolute',bottom:1,width:29,height:3,borderRadius:8,backgroundColor:C.accent},
  panelScroll:{flex:1},panelContent:{padding:18,paddingBottom:32,gap:12},taskSectionHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  panelTitle:{fontSize:25,fontWeight:'800',color:C.text},
  panelSubtitle:{fontSize:13,color:C.muted,marginBottom:10,lineHeight:20},
  infoCard:{padding:16,backgroundColor:C.surface,borderWidth:1,borderColor:C.line,borderRadius:16,gap:9},
  cardHeading:{fontSize:17,fontWeight:'700',color:C.text},stateBig:{fontSize:21,fontWeight:'700',color:C.green},
  taskText:{fontSize:14,lineHeight:22,color:C.text},
  terminalCard:{padding:13,borderRadius:12,backgroundColor:'#202128',gap:9},
  terminalLabel:{fontSize:12,color:'#A7E1B2'},
  terminalText:{fontSize:13,lineHeight:20,color:'#E9EAF2',fontFamily:Platform.OS==='android'?'monospace':'Menlo'},
  pathText:{fontSize:12,color:C.text},fileActions:{flexDirection:'row',gap:8,alignItems:'center'},
  fileItem:{paddingVertical:14,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:1,borderColor:C.line},
  fileGlyph:{fontSize:23,color:C.accent},fileName:{flex:1,color:C.text,fontSize:14},
  detailText:{fontSize:13,color:C.text,lineHeight:20},
  approvalDock:{marginHorizontal:12,marginBottom:4,padding:12,borderRadius:14,backgroundColor:C.surface2,borderColor:C.accent,borderWidth:1.5},
  sectionHeader:{color:C.muted,fontSize:12,fontWeight:'700',marginTop:16,marginBottom:8,paddingHorizontal:2},
  sessionHot:{borderColor:C.accent,borderWidth:1.2},
  toolCard:{backgroundColor:C.surface2,borderRadius:10,borderWidth:1,borderColor:C.line,padding:10,marginTop:8},
  toolCardError:{borderColor:C.red},
  toolCardTitle:{color:C.text,fontSize:13,lineHeight:19},
  toolDetailLabel:{color:C.muted,fontSize:11,fontWeight:'700',marginTop:8},
  toolDetail:{color:C.text,fontSize:12,lineHeight:18},

});
