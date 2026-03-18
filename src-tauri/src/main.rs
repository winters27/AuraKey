// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--service") {
        aurakey_lib::service_main::run_service();
    } else {
        aurakey_lib::run();
    }
}
