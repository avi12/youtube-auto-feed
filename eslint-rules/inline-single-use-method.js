/**
 * Flags a module-scoped FunctionDeclaration whose only reference is as the
 * value of an object shorthand property ({ foo }). Such a function exists
 * solely to populate one object method and should be inlined as a method
 * shorthand instead:
 *
 *   function foo(arg) { ... }          export const api = {
 *   export const api = {        ->       foo(arg) { ... }
 *     foo                              };
 *   };
 *
 * Does NOT flag:
 *   - exported functions (parent is ExportNamedDeclaration, not Program)
 *   - generators
 *   - functions referenced more than once
 *   - functions referenced in any way other than an object shorthand property
 *   - functions declared inside another function or block
 */

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "suggestion",
    fixable: "code",
    schema: [],
    messages: {
      inlineSingleUseMethod:
        "Function '{{name}}' is used only as an object shorthand property - inline it as a method."
    }
  },
  create(context) {
    const { sourceCode } = context;

    return {
      FunctionDeclaration(node) {
        if (node.parent.type !== "Program") {
          return;
        }

        if (node.generator) {
          return;
        }

        const [variable] = sourceCode.getDeclaredVariables(node);
        if (!variable || variable.references.length !== 1) {
          return;
        }

        const [reference] = variable.references;
        const refIdentifier = reference.identifier;
        const property = refIdentifier.parent;

        const isObjectShorthand = property
          && property.type === "Property"
          && property.shorthand
          && property.value === refIdentifier
          && property.parent.type === "ObjectExpression";
        if (!isObjectShorthand) {
          return;
        }

        context.report({
          node,
          messageId: "inlineSingleUseMethod",
          data: { name: node.id.name },
          fix(fixer) {
            const fullText = sourceCode.getText();
            const methodText = (node.async ? "async " : "")
              + node.id.name
              + fullText.slice(node.id.range[1], node.range[1]);

            let removalEnd = node.range[1];
            const trailingBlank = /^[ \t]*(\r?\n)([ \t]*\r?\n)*/.exec(fullText.slice(removalEnd));
            if (trailingBlank) {
              removalEnd += trailingBlank[0].length;
            }

            return [
              fixer.removeRange([node.range[0], removalEnd]),
              fixer.replaceTextRange(property.range, methodText)
            ];
          }
        });
      }
    };
  }
};
