import json
import os
import zipfile


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN_SLUG = "decky-quick-walkthrough"


def build_zip() -> str:
    with open(os.path.join(ROOT_DIR, "package.json"), "r", encoding="utf-8") as f:
        pkg = json.load(f)
    version = pkg.get("version", "1.0.0")
    out_zip = os.path.join(ROOT_DIR, f"{PLUGIN_SLUG}-v{version}.zip")

    include_files = [
        "plugin.json",
        "package.json",
        "main.py",
        "README.md",
        "LICENSE",
        os.path.join("dist", "index.js"),
    ]
    include_dirs = [
        "py_modules",
    ]

    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for rel in include_files:
            full = os.path.join(ROOT_DIR, rel)
            if not os.path.isfile(full):
                raise FileNotFoundError(f"Missing required build file: {full}")
            arcname = f"{PLUGIN_SLUG}/{rel.replace(os.sep, '/')}"
            zf.write(full, arcname=arcname)

        for d in include_dirs:
            full_dir = os.path.join(ROOT_DIR, d)
            for dirpath, dirnames, filenames in os.walk(full_dir):
                dirnames[:] = [dn for dn in dirnames if dn != "__pycache__"]
                for fn in sorted(filenames):
                    if fn.endswith((".pyc", ".pyo")) or fn == ".DS_Store":
                        continue
                    full_file = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full_file, ROOT_DIR)
                    arcname = f"{PLUGIN_SLUG}/{rel.replace(os.sep, '/')}"
                    zf.write(full_file, arcname=arcname)

    return out_zip


if __name__ == "__main__":
    zip_path = build_zip()
    print(f"Created {zip_path} ({os.path.getsize(zip_path)} bytes)")
