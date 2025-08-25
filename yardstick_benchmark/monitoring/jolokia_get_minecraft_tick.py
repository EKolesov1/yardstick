from urllib import request
from urllib.error import URLError, HTTPError
import argparse
import json
import time
import sys

PERIOD_S = 2.5

def get_tick_durations(old, new):
    assert old is None or len(old) == 100
    assert len(new) == 100
    if old is None:
        return []

    indices_first_new = []
    indices_last_new = []

    for i in range(100):
        j = (i + 1) % 100
        if old[i] == new[i] and old[j] != new[j]:
            indices_first_new.append(j)
        if old[i] != new[i] and old[j] == new[j]:
            indices_last_new.append(i)

    # default to first pair; adjust below if needed
    index_first_new = indices_first_new[0] if indices_first_new else 0
    index_last_new  = indices_last_new[0]  if indices_last_new  else 99

    if len(indices_first_new) != 1 or len(indices_last_new) != 1:
        maxlen = -1
        for s in indices_first_new or [0]:
            for e in indices_last_new or [99]:
                d = e - s if s <= e else 100 - s + e + 1
                if d > maxlen:
                    maxlen = d
                    index_first_new, index_last_new = s, e

    if index_first_new <= index_last_new:
        return new[index_first_new:index_last_new + 1]
    else:
        return new[index_first_new:] + new[:index_last_new + 1]

def main():
    # header for telegraf execd csv parser
    print("measurement,tick_duration_ms,tick_number,loop_iteration,timestamp_ms,computed_timestamp_ms")
    sys.stdout.flush()

    ap = argparse.ArgumentParser()
    ap.add_argument("--jolokia", default="http://127.0.0.1:8778/jolokia")
    args = ap.parse_args()
    base = args.jolokia.rstrip("/") + "/"

    req_body = json.dumps({
        "type": "read",
        "mbean": "net.minecraft.server:type=Server",
        "attribute": "tickTimes",
        "path": ""
    }).encode("utf-8")
    req = request.Request(base, data=req_body)

    prev = None
    tick_number = 0
    loop_iteration = 0
    computed_timestamp_ms = None
    prev_tick_ns = None

    t = time.monotonic()

    while True:
        t += PERIOD_S
        now = time.monotonic()
        time.sleep(max(0.0, t - now))
        now = time.monotonic()

        try:
            with request.urlopen(req, timeout=5) as resp:
                resp_enc = resp.read()
        except (URLError, HTTPError):
            # Jolokia not up yet; keep the process alive for Telegraf execd
            loop_iteration += 1
            continue

        try:
            resp_dict = json.loads(resp_enc.decode("utf-8"))
            curr = resp_dict["value"]  # list of 100 tick times in nanoseconds
        except Exception:
            loop_iteration += 1
            continue

        tick_times = get_tick_durations(prev, curr)
        prev = curr

        ts_ms_now = now * 1000.0
        for tick_ns in tick_times:
            # initialize computed timeline in ms; then advance by max(50 ms, last tick duration)
            if computed_timestamp_ms is None:
                computed_timestamp_ms = ts_ms_now
            else:
                # convert ns->ms for previous tick, use 50 ms minimum tick
                step_ms = max(50.0, (prev_tick_ns or 50_000_000) / 1e6)
                computed_timestamp_ms += step_ms

            print(
                f"minecraft_tick_duration,{tick_ns/1e6:.3f},{tick_number},{loop_iteration},{ts_ms_now:.3f},{computed_timestamp_ms:.3f}"
            )
            sys.stdout.flush()
            tick_number += 1
            prev_tick_ns = tick_ns

        loop_iteration += 1

if __name__ == "__main__":
    main()