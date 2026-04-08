use bun.  
use `browser` namespace.  
Don't use abbreviations in variable and function names, use full words.  
Avoid using `setTimeout`, except for polling every 5 seconds.  
Don't use "window." prefix.  
Don't assign types two variables, let TypeScript correctly infer them instead.  
Avoid giving functions explicit return types, let TypeScript correctly infer them instead.  
use 100% type safety, no `any` is allowed and avoid `unknown` unless absolutely necessary.  
use DRY and separation of concerns principles.  
Whenever possible, use object destructuring up to one level deep.  
Use early returns whenever it will increase the maintainability.  
Prefer async-await if it will make the code readable and maintainable.  
avoid comments, use self-descriptive variable and function names instead.  

Variable naming rules:
1. If a variable represents an element, it should be prefixed with "el"  
2. If a variable represents an index, it should be prefixed with "i", unless in a for loop/higher-order functions, where it can stay "i"
3. If a variable represents a boolean, it should be prefixed with "is"
