#!/usr/bin/env python3
"""Run the perf APK's offline presentation workloads and save their own metrics.

Each scenario launches the measurement activity with a run id, waits for that run's
single JSON line on logcat, and keeps the device-side frame and memory dumps next to
it. The activity already reports whether the newest snapshot was applied, so this
script never infers that from a skip count.
"""
import argparse
import json
import pathlib
import selectors
import subprocess
import time

SCENARIOS = ("history", "single", "format", "stream", "burst")
ACTIVITY = "me.rerere.rikkahub.ui.identity.PresentationBenchmarkActivity"
LOG_TAG = "OurFairyPresentation"




def wait_for_device(adb, timeout):
    """Wait for an attached device that reports `device`, up to [timeout] seconds."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = subprocess.run([*adb, "get-state"], capture_output=True, text=True)
        if state.returncode == 0 and state.stdout.strip() == "device":
            return True
        time.sleep(5)
    return False

def read_result_file(scenario, run_id, package="me.rerere.rikkahub", adb=None):
    """Read the activity's own result file for this run, or None when it is absent.

    The activity writes one file per run id, so a result can only ever be read back for the run
    that produced it. The measurement app is not debuggable, so this needs a device that allows
    root; the logcat line remains the fallback.
    """
    if adb is None:
        return None
    path = f"/data/data/{package}/files/presentation-{scenario}-{run_id}.json"
    try:
        text = subprocess.run([*adb, "shell", "cat", path], capture_output=True, text=True,
                              timeout=30)
    except subprocess.TimeoutExpired:
        return None
    if text.returncode != 0 or not text.stdout.strip().startswith("{"):
        return None
    try:
        return json.loads(text.stdout)
    except json.JSONDecodeError:
        return None



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial")
    parser.add_argument("--package", default="me.rerere.rikkahub")
    parser.add_argument("--scenario", choices=(*SCENARIOS, "all"), default="all")
    parser.add_argument("--rounds", type=int, default=1, help="Repeats of every selected scenario")
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--scroll", action="store_true",
                        help="Alternate swipes during stream to exercise user scroll priority")
    parser.add_argument("--timeout", type=float, default=180.0,
                        help="Seconds one run may take before it is recorded as a timeout")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    adb = [args.adb] + (["-s", args.serial] if args.serial else [])

    def call(*command, timeout=60):
        return subprocess.run([*adb, *command], check=True, capture_output=True,
                              text=True, timeout=timeout).stdout

    call("get-state")
    device = {
        "model": call("shell", "getprop", "ro.product.model").strip(),
        "fingerprint": call("shell", "getprop", "ro.build.fingerprint").strip(),
        "sdk": call("shell", "getprop", "ro.build.version.sdk").strip(),
        "refreshRate": call("shell", "dumpsys", "display").split("fps=")[-1].split()[0]
        if "fps=" in call("shell", "dumpsys", "display") else "unknown",
        "wmSize": call("shell", "wm", "size").strip(),
        "wmDensity": call("shell", "wm", "density").strip(),
        "fontScale": call("shell", "settings", "get", "system", "font_scale").strip(),
    }
    (args.out / "device.json").write_text(json.dumps(device, ensure_ascii=False, indent=2) + "\n")

    selected = SCENARIOS if args.scenario == "all" else (args.scenario,)
    failures = []
    for round_index in range(1, args.rounds + 1):
        for scenario in selected:
            if not wait_for_device(adb, args.timeout):
                raise SystemExit(f"device unavailable before {scenario} round {round_index}; "
                                 f"see {args.out}")
            run_id = f"{scenario}-r{round_index}-{time.time_ns()}"
            started = time.monotonic()
            log = subprocess.Popen([*adb, "logcat", "-T", time.strftime("%m-%d %H:%M:%S.000", time.localtime(started)),
                                    "-v", "raw", f"{LOG_TAG}:I", "*:S"],
                                   stdout=subprocess.PIPE, text=True)
            selector = selectors.DefaultSelector()
            selector.register(log.stdout, selectors.EVENT_READ)
            try:
                launch = call("shell", "am", "start", "-n", f"{args.package}/{ACTIVITY}",
                              "--es", "scenario", scenario, "--es", "runId", run_id)
                (args.out / f"{scenario}-r{round_index}-launch.txt").write_text(launch)
                if "Error" in launch:
                    raise RuntimeError(launch)
                next_swipe = started + 5
                reverse = False
                result = None
                while time.monotonic() - started < args.timeout:
                    # Prefer the run's own result file: it is written before the log line and
                    # survives a rotated log ring, which a busy device produces routinely.
                    result = read_result_file(scenario, run_id, args.package, adb)
                    if args.scroll and scenario == "stream" and time.monotonic() >= next_swipe:
                        size = call("shell", "wm", "size").strip().split()[-1]
                        width, height = (int(value) for value in size.split("x"))
                        top, bottom = int(height * 0.3), int(height * 0.7)
                        call("shell", "input", "swipe", str(width // 2), str(top if reverse else bottom),
                             str(width // 2), str(bottom if reverse else top), "300")
                        reverse = not reverse
                        next_swipe = time.monotonic() + 5
                    for key, _ in selector.select(timeout=0.5):
                        line = key.fileobj.readline()
                        if not line:
                            continue
                        if not line.startswith("{"):
                            continue
                        value = json.loads(line)
                        if value.get("runId") == run_id:
                            result = value
                            break
                    if result is not None:
                        break
                    time.sleep(1.0)
                if result is None:
                    # The activity also writes its own result file. A busy device can rotate the
                    # logcat ring before this reader sees the line, so fall back to that file
                    # before declaring the run missing.
                    result = read_result_file(scenario, run_id, args.package, adb)
                if result is None:
                    # Preserve whatever the activity did write, so a timeout still carries evidence.
                    late = read_result_file(scenario, run_id, args.package, adb)
                    if late is not None:
                        (args.out / f"{scenario}-r{round_index}-late.json").write_text(
                            json.dumps(late, ensure_ascii=False, indent=2) + "\n")
                    raise TimeoutError(f"{scenario} round {round_index} did not report in {args.timeout}s")
                if result.get("runId") != run_id:
                    raise TimeoutError(
                        f"{scenario} round {round_index}: the result belongs to run {result.get('runId')},"
                        f" not {run_id}")
                (args.out / f"{scenario}-r{round_index}.json").write_text(
                    json.dumps(result, ensure_ascii=False, indent=2) + "\n")
                (args.out / f"{scenario}-r{round_index}-frames.txt").write_text(
                    call("shell", "dumpsys", "gfxinfo", args.package, "framestats", timeout=120))
                (args.out / f"{scenario}-r{round_index}-memory.txt").write_text(
                    call("shell", "dumpsys", "meminfo", args.package, timeout=120))
                print(f"{scenario} r{round_index}: applied={result.get('latestVersionApplied')} "
                      f"p95={result.get('receiveToFrameP95Ms')} terminal={result.get('terminalRichPresentedMs')}",
                      flush=True)
            except Exception as failure:  # record and keep the remaining rounds
                failures.append(f"{scenario} r{round_index}: {failure}")
                (args.out / f"{scenario}-r{round_index}-failure.txt").write_text(str(failure))
                print(f"{scenario} r{round_index}: FAILED {failure}", flush=True)
            finally:
                selector.close()
                log.terminate()
                log.wait(timeout=10)

    if failures:
        (args.out / "failures.txt").write_text("\n".join(failures) + "\n")
        raise SystemExit(f"{len(failures)} run(s) failed; see {args.out / 'failures.txt'}")


if __name__ == "__main__":
    main()
