import { isTauri } from '@tauri-apps/api/core';

type Level = 'error' | 'warn' | 'info';

/** Writes to the rotating native log; outside the desktop app only the console is used. */
export function writeLog(level: Level, message: string) {
  if (level === 'error') console.error(message);
  else if (level === 'warn') console.warn(message);
  if (!isTauri()) return;
  void import('@tauri-apps/plugin-log')
    .then((log) =>
      (level === 'error' ? log.error : level === 'warn' ? log.warn : log.info)(message),
    )
    .catch(() => {});
}

export function installErrorLogging() {
  window.addEventListener('error', (event) =>
    writeLog('error', `${event.message} (${event.filename}:${event.lineno})`),
  );
  window.addEventListener('unhandledrejection', (event) =>
    writeLog('error', `Unhandled rejection: ${String(event.reason)}`),
  );
}
