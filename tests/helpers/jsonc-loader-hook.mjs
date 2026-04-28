export async function resolve(specifier, context, nextResolve) {
    if (specifier === "jsonc-parser/lib/esm/main.js") {
        return nextResolve("jsonc-parser", context)
    }
    return nextResolve(specifier, context)
}
