import os
import re
import subprocess
import sys

def main():
    print("===================================================")
    print(" IEEE IES Day 2026 - Google Cloud Run Deployer")
    print("===================================================")

    env_path = ".env"
    if not os.path.exists(env_path):
        print("[ERROR] .env file not found!")
        sys.exit(1)

    env_vars = {}
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip().strip('"').strip("'")

    script_url = env_vars.get("GOOGLE_APPS_SCRIPT_URL")
    secret = env_vars.get("REGISTRATION_SECRET")

    if not script_url or not secret:
        print("[ERROR] Missing GOOGLE_APPS_SCRIPT_URL or REGISTRATION_SECRET in .env")
        sys.exit(1)

    service_name = "ies-registration-backend"
    region = "asia-south1"

    cmd = [
        "gcloud", "run", "deploy", service_name,
        "--source", ".",
        "--region", region,
        "--allow-unauthenticated",
        f"--set-env-vars=GOOGLE_APPS_SCRIPT_URL={script_url},REGISTRATION_SECRET={secret}"
    ]

    print(f"Deploying {service_name} to Google Cloud Run ({region})...")
    ret = subprocess.run(cmd)

    if ret.returncode != 0:
        print("[ERROR] Deployment command failed.")
        sys.exit(ret.returncode)

    # Get service URL
    url_res = subprocess.run(
        ["gcloud", "run", "services", "describe", service_name, "--region", region, "--format=value(status.url)"],
        capture_output=True,
        text=True
    )
    service_url = url_res.stdout.strip()

    print("\n===================================================")
    print(" Deployment Successful!")
    print(f" Backend URL: {service_url}")
    print("===================================================\n")

    # Update index.html
    index_path = "index.html"
    if os.path.exists(index_path) and service_url:
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()

        new_html = re.sub(
            r"backendUrl:\s*['\"][^'\"]*['\"]",
            f"backendUrl: '{service_url}'",
            html
        )

        with open(index_path, "w", encoding="utf-8") as f:
            f.write(new_html)

        print(f"Updated index.html automatically with backendUrl: '{service_url}'")
        subprocess.run(["npm", "run", "build"])

if __name__ == "__main__":
    main()
