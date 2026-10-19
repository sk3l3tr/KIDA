# python3 scripts/record-demo.py --demo scheduler
Require kida-demo-guard
Output assets/scheduler.gif
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
Type "# KIDA | Schedule a daily backup"
Enter
Type "cat schedule.toml"
Enter
Wait+Screen /seconds = 86400/
Sleep 4s
Ctrl+L
Type "kida scheduler add -f schedule.toml"
Enter
Wait+Screen /Schedule added/
Sleep 3s
Type "kida scheduler list"
Enter
Wait+Screen /interval every 86400 seconds/
Sleep 7s
