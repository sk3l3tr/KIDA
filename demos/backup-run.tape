# python3 scripts/record-demo.py --demo backup-run
Require kida-demo-guard
Output assets/backup-run.gif
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
Type "# KIDA | Configure once, back up on demand"
Enter
Type "cat backup.toml"
Enter
Wait+Screen /path = "\/demo\/backups"/
Sleep 3s
Type "kida backup config create -f backup.toml"
Enter
Wait+Screen /Backup job on-demand created/
Sleep 3s
Type "kida backup run --name on-demand"
Enter
Wait+Screen /Backup queued \(Execution ID:/
Sleep 7s
