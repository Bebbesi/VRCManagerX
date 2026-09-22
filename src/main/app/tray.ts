import { Menu, Tray, nativeImage } from 'electron'
import { resourcePath } from './window'

export interface TrayActions {
  show(): void
  quit(): void
  isAutomationEnabled(): boolean
  setAutomationEnabled(enabled: boolean): void
  statusLine(): string
}

/** System tray icon so the automation keeps running when the window is closed. */
export class AppTray {
  private readonly tray: Tray
  private hiddenNoticeShown = false

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(nativeImage.createFromPath(resourcePath('tray.png')))
    this.tray.on('click', () => actions.show())
    this.update()
  }

  update(): void {
    const status = this.actions.statusLine()
    this.tray.setToolTip(`VRCManagerX - ${status}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open VRCManagerX', click: () => this.actions.show() },
        { label: status, enabled: false },
        { type: 'separator' },
        {
          label: 'Enable Automation',
          type: 'checkbox',
          checked: this.actions.isAutomationEnabled(),
          click: (item) => this.actions.setAutomationEnabled(item.checked)
        },
        { type: 'separator' },
        { label: 'Quit', click: () => this.actions.quit() }
      ])
    )
  }

  /** Tells the user (once) that closing the window did not stop the automation. */
  notifyHidden(): void {
    if (this.hiddenNoticeShown) return
    this.hiddenNoticeShown = true
    try {
      this.tray.displayBalloon({
        title: 'VRCManagerX is still running',
        content: 'Invite requests keep being handled in the background. Use the tray icon to open or quit.',
        iconType: 'info'
      })
    } catch {
      // Balloons are Windows-only.
    }
  }

  destroy(): void {
    this.tray.destroy()
  }
}
