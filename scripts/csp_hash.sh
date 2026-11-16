#!/usr/bin/env bash
# Prints the CSP hash of the inline <script> in public/index.html (paste into public/_headers after editing it).
cd "$(dirname "$0")/.." && python3 -c "
import re,hashlib,base64
s=open('public/index.html').read(); m=re.search(r'<script>(.*?)</script>',s,re.S)
print(\"'sha256-\" + base64.b64encode(hashlib.sha256(m.group(1).encode()).digest()).decode() + \"'\")"
