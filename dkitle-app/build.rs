fn main() {
    // Embed icon and version info on Windows
    #[cfg(target_os = "windows")]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        res.set("ProductName", "dkitle");
        res.set("FileDescription", "dkitle - Desktop subtitle overlay");
        res.compile().expect("Failed to compile Windows resources");
    }
}
