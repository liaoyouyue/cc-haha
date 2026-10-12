import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ActionEvidenceNotice } from './ActionEvidenceNotice'
import { useSettingsStore } from '../../stores/settingsStore'

describe('ActionEvidenceNotice', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
  })

  it('names the unsupported claim it is warning about', () => {
    render(<ActionEvidenceNotice issue={{ claims: ['已创建', '写好了'], evidenceTools: [] }} />)

    const notice = screen.getByRole('status')
    expect(notice).toHaveAttribute('data-action-evidence')
    expect(notice).toHaveTextContent('已创建 / 写好了')
  })
})
