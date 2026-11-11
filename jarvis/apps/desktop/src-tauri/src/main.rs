// JARVIS desktop shell (Tauri 2, Windows / macOS / Linux).
// - Opens the JARVIS command center from the local server (JARVIS_URL, default http://127.0.0.1:7777)
// - System tray: show/hide, push-to-talk, quit
// - Global shortcuts: Ctrl/Cmd+Shift+J toggles the window, Ctrl/Cmd+Shift+Space push-to-talk
// - Closing the window keeps JARVIS running in the tray (background assistant)
// OS actions (open apps, files, screenshots) stay in the separate least-privilege desktop bridge.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const PTT_JS: &str = "window.dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'Space', bubbles: true }));";

fn server_url() -> String {
    std::env::var("JARVIS_URL").unwrap_or_else(|_| "http://127.0.0.1:7777".into())
}

/// True when the JARVIS server accepts TCP connections.
fn server_up(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("127.0.0.1");
    let port = url.port_or_known_default().unwrap_or(7777);
    use std::net::ToSocketAddrs;
    (host, port).to_socket_addrs().ok().and_then(|mut a| a.next())
        .map(|addr| std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(800)).is_ok())
        .unwrap_or(false)
}

fn toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

fn push_to_talk(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.eval(PTT_JS);
    }
}

fn main() {
    let toggle_sc = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyJ);
    let toggle_sc_ctrl = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyJ);
    let ptt_sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| toggle(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, sc, ev| {
                    if ev.state() != ShortcutState::Pressed { return; }
                    if sc == &ptt_sc { push_to_talk(app) } else { toggle(app) }
                })
                .build(),
        )
        .setup(move |app| {
            let url: tauri::Url = server_url().parse().expect("JARVIS_URL must be a valid URL");
            // If the server is down, show a local page that retries and then redirects.
            let target = if server_up(&url) { WebviewUrl::External(url.clone()) }
                else { WebviewUrl::App(format!("index.html?server={}", url).into()) };
            WebviewWindowBuilder::new(app, "main", target)
                .title("J.A.R.V.I.S")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .build()?;

            // Shortcuts may already be taken by another app; JARVIS keeps working without them.
            for sc in [toggle_sc, toggle_sc_ctrl, ptt_sc] {
                if let Err(e) = app.global_shortcut().register(sc) { eprintln!("shortcut unavailable: {e}"); }
            }

            let show = MenuItem::with_id(app, "show", "Show / hide JARVIS", true, None::<&str>)?;
            let talk = MenuItem::with_id(app, "talk", "Push to talk", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &talk, &quit])?;
            TrayIconBuilder::with_id("jarvis")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("JARVIS")
                .menu(&menu)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => toggle(app),
                    "talk" => push_to_talk(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|w, e| {
            // keep running in the tray instead of quitting
            if let WindowEvent::CloseRequested { api, .. } = e { let _ = w.hide(); api.prevent_close(); }
        })
        .run(tauri::generate_context!())
        .expect("error while running JARVIS");
}
