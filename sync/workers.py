"""The shared worker pool every blocking job runs on.

Its own module since v2.10.3: main.py and realtime_supervisor.py both submit
to it, and leaving the entrypoint to own it meant the supervisor could only
reach it through an import cycle.
"""

from concurrent.futures import ThreadPoolExecutor

# 2 was too few once a setup could block a worker for minutes: a bank polled
# for a phone approval holds one for up to 180s, a scheduled sync takes the
# other, and the next "Connect" click then waits for a free worker with no
# feedback - reported as a button that spins forever (issue #51). These threads
# are I/O-bound (waiting on banks), so a few more cost almost nothing.
executor = ThreadPoolExecutor(max_workers=6)
