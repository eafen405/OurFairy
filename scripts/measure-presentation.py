#!/usr/bin/env python3
"""Run the release APK's offline presentation workloads and save their own metrics."""
import argparse
import json
import pathlib
import selectors
import subprocess
import time

SCENARIOS = ("history", "single", "format", "stream", "burst")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial")
    parser.add_argument("--package", default="me.rerere.rikkahub")
    parser.add_argument("--scenario", choices=(*SCENARIOS, "all"), default="all")
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--scroll", action="store_true", help="Alternate swipes during stream to exercise user scroll priority")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    adb = [args.adb] + (["-s", args.serial] if args.serial else [])

    def call(*command):
        return subprocess.run([*adb, *command], check=True, capture_output=True, text=True, timeout=15).stdout

    call("get-state")
    (args.out / "device.txt").write_text(call("shell", "getprop", "ro.product.model") + call("shell", "getprop", "ro.build.fingerprint"))
    for scenario in SCENARIOS if args.scenario == "all" else (args.scenario,):
        run_id = str(time.time_ns())
        started = time.monotonic()
        log = subprocess.Popen([*adb, "logcat", "-T", "1", "-v", "raw", "OurFairyPresentation:I", "*:S"], stdout=subprocess.PIPE, text=True)
        selector = selectors.DefaultSelector()
        selector.register(log.stdout, selectors.EVENT_READ)
        try:
            launch = call("shell", "am", "start", "-n", f"{args.package}/me.rerere.rikkahub.ui.identity.PresentationBenchmarkActivity", "--es", "scenario", scenario, "--es", "runId", run_id)
            (args.out / f"{scenario}-launch.txt").write_text(launch)
            if "Error" in launch:
                raise RuntimeError(launch)
            next_swipe = started + 2
            reverse = False
            result = None
            while time.monotonic() - started < 180:
                if args.scroll and scenario == "stream" and time.monotonic() >= next_swipe:
                    # Fixed coordinates in the 480dp transcript on a portrait phone; adjust with wm size.
                    size = call("shell", "wm", "size").strip().split()[-1]
                    width, height = (int(value) for value in size.split("x"))
                    top, bottom = int(height * 0.3), int(height * 0.7)
                    call("shell", "input", "swipe", str(width // 2), str(top if reverse else bottom), str(width // 2), str(bottom if reverse else top), "300")
                    reverse = not reverse
                    next_swipe = time.monotonic() + 2
                for key, _ in selector.select(timeout=0.2):
                    line = key.fileobj.readline()
                    if not line:
                        raise RuntimeError("adb logcat ended before the workload reported")
                    if not line.startswith("{"):
                        continue
                    value = json.loads(line)
                    if value.get("runId") == run_id:
                        result = value
                        break
                if result is not None:
                    break
            if result is None:
                raise TimeoutError(f"{scenario} did not report within 180 seconds; preserve logcat/crash evidence")
            (args.out / f"{scenario}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
            (args.out / f"{scenario}-frames.txt").write_text(call("shell", "dumpsys", "gfxinfo", args.package, "framestats"))
            (args.out / f"{scenario}-memory.txt").write_text(call("shell", "dumpsys", "meminfo", args.package))
            print(f"{scenario}: saved {args.out / (scenario + '.json')}", flush=True)
        finally:
            selector.close()
            log.terminate()
            log.wait(timeout=5)


if __name__ == "__main__":
    main()
