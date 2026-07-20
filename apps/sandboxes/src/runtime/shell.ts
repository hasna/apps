/** POSIX single-quote shell joining for argv -> command string. */
export function shellJoin(argv: string[]): string {
  return argv
    .map((arg) => (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(arg) ? arg : `'${arg.replace(/'/gu, `'\\''`)}'`))
    .join(" ")
}
