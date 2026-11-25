use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=PIKBAY_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=PIKBAY_ALLOW_EMPTY_DIST");
    println!("cargo:rerun-if-changed=web/dist");

    // Watch .git/HEAD and its target ref file so local commits refresh PIKBAY_BUILD_COMMIT automatically
    let git_head = Path::new(".git/HEAD");
    if git_head.exists() {
        println!("cargo:rerun-if-changed=.git/HEAD");
        if let Ok(head_raw) = fs::read_to_string(git_head) {
            if let Some(rel_ref) = head_raw.trim().strip_prefix("ref: ") {
                println!("cargo:rerun-if-changed=.git/{rel_ref}");
            }
        }
        if Path::new(".git/packed-refs").exists() {
            println!("cargo:rerun-if-changed=.git/packed-refs");
        }
    }

    let dist_dir = Path::new("web/dist");
    let index_html = dist_dir.join("index.html");
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let allow_empty = std::env::var("PIKBAY_ALLOW_EMPTY_DIST").ok().as_deref() == Some("1");

    if profile == "release" && !allow_empty && !index_html.exists() {
        panic!(
            "Release build requires prebuilt frontend assets at `web/dist/index.html`. Run `cd web && npm ci && npm run build` first (or set PIKBAY_ALLOW_EMPTY_DIST=1 to bypass)."
        );
    }

    // Create an empty directory in debug/unit-test builds when frontend assets have not been built yet
    if !dist_dir.exists() {
        let _ = fs::create_dir_all(dist_dir);
    }

    let commit = std::env::var("PIKBAY_BUILD_COMMIT")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            Command::new("git")
                .args(["rev-parse", "--short=8", "HEAD"])
                .output()
                .ok()
                .filter(|out| out.status.success())
                .and_then(|out| String::from_utf8(out.stdout).ok())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=PIKBAY_BUILD_COMMIT={commit}");
}
