fn main() {
    // tauri_build generates resource manifests for the GUI binary.
    // It's safe to run unconditionally — it emits cargo:rerun-if-changed
    // and resource link directives that only affect binaries consuming them.
    tauri_build::build()
}
