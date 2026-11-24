// Security audit lead `kde/notifications.ts:buildNotificationContent:unescaped-markup-body`: the
// body carries model-chosen text (the pending command), and on Linux a notification server with
// `body-markup` (KDE Plasma) reads it as markup. Fault: a raw `<` or `&` from that text reaching
// the Linux server, so a command could show as a link or make the server fetch an image.
import { describe, expect, it } from 'vitest'
import { buildNotificationContent, osNotificationBody } from './notifications'

const hostile =
  '<a href="https://example.invalid/">y</a> <img src="https://example.invalid/i"> &amp;'

function raisedBody(): string {
  return buildNotificationContent({
    type: 'attention.raised',
    timestamp: 0,
    id: 's1',
    sessionName: 'n',
    projectPath: '/p',
    status: 'NeedsPermission',
    pendingToolName: 'Bash',
    pendingToolDetail: hostile
  }).body
}

describe('notification body markup', () => {
  it('on Linux the body reaches the server with no markup the server would read', () => {
    const body = osNotificationBody(raisedBody(), 'linux')
    expect(body).not.toMatch(/[<>]/)
    expect(body).not.toMatch(/&(?!amp;|lt;|gt;)/)
    expect(body).toContain('&lt;a href="https://example.invalid/"&gt;y&lt;/a&gt;')
    expect(body).toContain('&amp;amp;')
  })

  it('on macOS and Windows the body stays plain text as is', () => {
    expect(osNotificationBody(raisedBody(), 'darwin')).toBe(raisedBody())
    expect(osNotificationBody(raisedBody(), 'win32')).toBe(raisedBody())
  })
})
