const START = "<!-- pi-harness:start -->";
const END = "<!-- pi-harness:end -->";
export function mergeBody(existing, generated) {
  if (generated.includes(START) || generated.includes(END))
    throw new Error("Generated body contains reserved markers");
  const managed = `${START}\n${generated}\n${END}`;
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start < 0 && end < 0)
    return `${existing.trimEnd()}\n\n${managed}`.trimStart();
  if (
    start < 0 ||
    end < start ||
    existing.indexOf(START, start + START.length) >= 0 ||
    existing.indexOf(END, end + END.length) >= 0
  )
    throw new Error("Ambiguous managed PR body; resolve markers manually");
  return existing.slice(0, start) + managed + existing.slice(end + END.length);
}
