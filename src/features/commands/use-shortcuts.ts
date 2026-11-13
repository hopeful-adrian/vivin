import { dialog, finishDialog } from '../ui/use-dialog';
import { closeMenus, openMenu } from '../ui/use-menus';
import { focusMode, palette, platform, settingsOpen } from '../workspace/use-layout';
import { activePane, closeFind, panes } from '../workspace/use-panes';
import { commands, matchesShortcut, runCommand } from './use-commands';

/** Window-level shortcuts; modal layers consume Escape before the workspace does. */
export function handleShortcut(event: KeyboardEvent) {
  const macos = platform.value === 'macos';
  // Leave macOS's native Control-Command-F fullscreen shortcut to the system.
  if (macos && event.ctrlKey && event.metaKey && event.key.toLowerCase() === 'f') return;
  if (event.key === 'Escape') {
    if (macos) event.preventDefault();
    handleEscape(event);
    return;
  }
  if (dialog.value) return;
  if (palette.value || settingsOpen.value) {
    if (!(event.metaKey || event.ctrlKey)) return;
  }
  for (const command of commands.value) {
    if (!command.shortcut || !matchesShortcut(event, command.shortcut, macos)) continue;
    event.preventDefault();
    event.stopPropagation();
    if (palette.value && command.id !== 'palette' && command.id !== 'quick-open')
      palette.value = null;
    runCommand(command);
    return;
  }
}

function consume(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function handleEscape(event: KeyboardEvent) {
  if (dialog.value) {
    consume(event);
    finishDialog(false);
    return;
  }
  if (palette.value) {
    consume(event);
    palette.value = null;
    return;
  }
  if (settingsOpen.value) {
    consume(event);
    settingsOpen.value = false;
    return;
  }
  const modal = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (modal) {
    consume(event);
    modal.close();
    return;
  }
  if (openMenu.value) {
    consume(event);
    closeMenus();
    return;
  }
  if (panes.value[activePane.value]?.findOpen) {
    consume(event);
    closeFind(activePane.value);
    return;
  }
  for (const pane of panes.value) pane.outlineOpen = false;
  if (focusMode.value) focusMode.value = false;
}
