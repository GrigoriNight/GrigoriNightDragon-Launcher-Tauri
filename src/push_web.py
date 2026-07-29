"""Publish the built launcher to the PUBLIC gnd-news repo via the GitHub
Contents API, so the GoDaddy loader (ai.html) can fetch it with no token.

Usage:
    GITHUB_TOKEN=<fine-grained token> python push_web.py

The token needs Contents: Read & write on GrigoriNight/gnd-news only — the
same token the launcher Admin panel uses for news. It is read from the
environment and NEVER written to disk or committed.

Run after build_web.py (or `python build_web.py --publish` does both).
"""
import os, sys, json, base64, urllib.request, urllib.error

OWNER, REPO, BRANCH = "GrigoriNight", "gnd-news", "main"
SRC_FILE = "Launcher.godaddy.html"   # local build artifact (build_web.py output)
DST_PATH = "Launcher.godaddy.html"   # path at the gnd-news repo root (what ai.html fetches)

def die(msg):
    sys.stderr.write(msg.rstrip() + "\n"); sys.exit(1)

token = (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or "").strip()
if not token:
    die("Missing $GITHUB_TOKEN (fine-grained token, Contents:write on "
        + OWNER + "/" + REPO + "). Not reading any token from disk.")

try:
    html = open(SRC_FILE, encoding="utf-8").read()
except FileNotFoundError:
    die(SRC_FILE + " not found — run build_web.py first.")

api = "https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + DST_PATH
headers = {
    "Authorization": "token " + token,
    "Accept": "application/vnd.github+json",
    "User-Agent": "gnd-web-publisher",
}

def request(method, url, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        try: detail = json.loads(detail).get("message", detail)
        except Exception: pass
        return e.code, {"message": detail}

# 1) current sha (needed to update an existing file; absent => first publish)
sha = None
status, gd = request("GET", api + "?ref=" + BRANCH)
if status == 200:
    sha = gd.get("sha")
elif status in (401, 403):
    die("GitHub rejected the token (check scope/expiry): " + str(gd.get("message")))
elif status != 404:
    die("Unexpected GitHub response " + str(status) + ": " + str(gd.get("message")))

# 2) PUT the new content
payload = {
    "message": "web: publish launcher build via push_web.py",
    "content": base64.b64encode(html.encode("utf-8")).decode("ascii"),
    "branch": BRANCH,
}
if sha:
    payload["sha"] = sha
status, rd = request("PUT", api, payload)
if status not in (200, 201):
    die("GitHub publish failed (HTTP " + str(status) + "): " + str(rd.get("message")))

commit = (rd.get("commit") or {}).get("html_url", "")
print("Published " + SRC_FILE + " (" + str(len(html)) + " chars) -> "
      + OWNER + "/" + REPO + "/" + DST_PATH + " @ " + BRANCH)
if commit:
    print("Commit: " + commit)
print("Live in ~1-2 min: https://raw.githubusercontent.com/"
      + OWNER + "/" + REPO + "/" + BRANCH + "/" + DST_PATH)
