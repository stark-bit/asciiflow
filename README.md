# [![No Maintenance Intended](http://unmaintained.tech/badge.svg)](http://unmaintained.tech/)

ASCIIFlow is a client-side only web based application for drawing ASCII diagrams. You can use the original forked version at [asciiflow.com](https://asciiflow.com) or build this adjusted* version yourself

Adjustments
- PWA support
- improve keyboard navigation
  - `cmd`/`option` big step navigation
    - `cmd` (10 steps up,down,left,right, backspace 10x)
    - `cmd+option` = 30 steps
- re-org hotkeys
  - hotkeys trigger on numbers unless text
  - change order
- edit zoom in logic
  -  zoom on cursor location (not some random location)
- Lite version
  - remove `bazel`
  - remove `electron`





