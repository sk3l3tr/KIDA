# python3 scripts/record-demo.py --demo backup-health
# A real backup and CREATED manual run are prepared before recording.
# run_id and restore_dir refer exclusively to that run in the private agent.
Require kida-demo-guard
Output assets/backup-health.gif
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
Set TypingSpeed 35ms
Set CursorBlink false

Hide
Type "source /demo/session.sh || exit 1"
Enter
Wait+Screen /DEMO_READY/
Ctrl+L
Show
Type "# KIDA | Restore, verify, clean up"
Enter
Type `kida backup health start --run-id "$run_id"`
Enter
Wait+Screen /Backup Health admitted/
Sleep 1s

Hide
Type "python3 /repo/scripts/record-demo.py --wait-health"
Enter
Wait+Screen@60s /HEALTH_READY/
Ctrl+L
Show
Type `cat "$restore_dir/demo/site/index.html"`
Enter
Wait+Screen /<h1>KIDA demo site<\/h1>/
Sleep 2s
Type `kida backup health get --run-id "$run_id" | sed -n '4,8p;15p'`
Enter
Wait+Screen /Technical result: HEALTHY/
Sleep 4s

Ctrl+L
Type `kida backup health delete --run-id "$run_id" | sed -n '4,8p;15p'`
Enter
Wait+Screen /Cleanup: COMPLETED/
Sleep 5s
