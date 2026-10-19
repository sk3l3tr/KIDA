# Regenerate safely with: python3 scripts/record-demo.py
# Run only through the runner: it supplies a private agent and Docker daemon.
Require kida-demo-guard
Output assets/demo.gif

Set Shell bash
Set Theme "Catppuccin Mocha"
Set FontFamily "Fira Code"
Set FontSize 20
Set Width 1000
Set Height 560
Set Padding 28
Set Margin 12
Set BorderRadius 12
Set WindowBar Colorful
Set WindowBarSize 32
Set Framerate 20
Set TypingSpeed 40ms
Set CursorBlink false

Hide
Type "source /demo/session.sh || exit 1"
Enter
Wait+Screen /DEMO_READY/
Ctrl+L
Show

Type "# KIDA | Container lifecycle + backups"
Enter
Sleep 1s

Type "kida docker containers list"
Enter
Wait+Screen /demo-web/
Sleep 3s

Type "kida docker container restart demo-web"
Enter
Wait+Screen /Container demo-web is restarted\./
Sleep 3s

Type "kida backup run --name demo-site"
Enter
Wait+Screen /Backup queued \(Execution ID:/
Sleep 6s
