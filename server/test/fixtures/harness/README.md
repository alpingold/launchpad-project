# Broken games for the harness tests

Each file here breaks exactly one rule, so `test/unit/harness.test.js` can prove the
game test harness (plan §11c, A2) catches it with a helpful message. They are plain
source files, loaded the way generated games will be, and never registered anywhere.
