"""Extract only the two required app identifiers from an aapt2 resource dump."""
import json
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8-sig")
def value(name):
    match = re.search(r'string/' + name + r'\s+\(\) "([^"]+)"', source)
    if not match:
        raise SystemExit(f"Missing resource: {name}")
    return match.group(1)

target = Path(__file__).resolve().parent.parent / ".anwb-local.json"
target.write_text(json.dumps({"clientId": value("apigee_apikey_prod"), "apiKey": value("kong_apikey")}), encoding="utf-8")
print(f"Saved local API settings to {target.name}; values are not printed.")
