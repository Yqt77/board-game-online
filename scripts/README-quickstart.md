# Windows quick start

1. Open PowerShell in this project folder.
2. Run the installer:

```powershell
.\scripts\install-cloudflared.ps1
```

3. After it finishes, start the public tunnel:

```powershell
.\scripts\start-public.ps1
```

4. Copy the `https://xxxx.trycloudflare.com` URL from the output.
5. Paste that URL into the app's `公网地址` field.
