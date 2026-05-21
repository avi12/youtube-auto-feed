# Stack
- bun
- WXT extension framework
- TypeScript (100% type safety, let TypeScript infer types)
- @webext-core/messaging for message passing
- Chromium (Chrome, Edge, Opera) + Firefox MV3

# Code style
- Use the `browser` namespace
- Use early returns for readability and maintainability
- Use functional programming
- Use `for-of` instead of `.forEach`
- Use async/await whenever possible
- Use DRY with separation of concerns, prioritizing readability
- Minimize indentations
- Use modern browser and CSS features
- Don't use `window.` prefix
- Avoid `setTimeout` except for polling every 5 seconds
- Avoid comments - prefer descriptive names
- Don't use em dashes - use regular hyphens
- Don't annotate the type on a callback arrow function's parameter when it can be inferred
- Avoid nested try/catch - flatten with early returns or extracted functions
- Apply parallel modifications whenever possible
- Use object destructuring up to one level deep

# Naming conventions
- Variables and functions: `camelCase`, full words (no abbreviations)
- Module-level constants: `SCREAMING_SNAKE_CASE`
- Exception: event handler first parameter is always `e`

## Variable prefixes
- Element: `el` prefix (e.g. `elButton`)
- Index: `i` prefix (e.g. `iItem`), or bare `i` when iterating in a for loop/higher-order function
- Boolean: `is` prefix (e.g. `isLoading`)

# Types
- 100% type safety: no `any`, avoid `unknown` unless absolutely necessary
- Let TypeScript infer variable and function return types - don't annotate explicitly
- Exception: type predicates require an explicit return type

# Workflow
- After each modification, run `pnpm lint` across the project

# Hardcoded values
- Strings: use enums; if no enum fits, use a descriptive `SCREAMING_SNAKE_CASE` constant
- Numbers: use a descriptive `SCREAMING_SNAKE_CASE` constant
