import type { SelectableEffortLevel } from './settings'

export type RuntimeSelection = {
  providerId: string | null
  modelId: string
  effortLevel?: SelectableEffortLevel
  openAIFastMode?: boolean
}
