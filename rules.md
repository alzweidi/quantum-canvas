🛠️ Guiding Rules for Code Quality & Reliability (JavaScript Edition)
📏 Code Style & Formatting
Format all JavaScript code using Prettier with its default settings.

Lint for code quality and potential errors using ESLint.

Maximum line length: 88 characters (configurable in Prettier).

🔍 Modularity & Single Responsibility
One module = one responsibility. Modules: constants, SimulationState, ComputationEngine, Renderer, UIController, main.

Adhere strictly to ES Modules (import/export). No circular dependencies.

📖 Naming & Documentation
Use clearly descriptive, camelCase names for functions and variables (function myExample()), and PascalCase for classes (class MyExample {}).

Use JSDoc comment blocks (/** ... */) for every public function and class.

⚠️ Error Handling & Logging
Wrap operations that can fail (e.g., WebGL extension checks) in try/catch blocks.

Use the browser's console object for logging: console.log() for general information, console.warn() for non-critical issues, and console.error() for failures. Absolutely no alert() for debugging.

Provide clear error messages to the user for critical failures (e.g., "WebGL not supported").

🔒 Configuration
No hard-coded "magic numbers" in the logic. All simulation parameters, physics constants, and grid dimensions must be defined in and imported from src/constants.js.

🕒 Scheduling & Animation
All simulation and rendering updates must be driven by requestAnimationFrame. Do not use setInterval or setTimeout for the main loop.

✅ Testing & Coverage
Use a modern testing framework like Vitest or Jest.

Achieve 100% test coverage for core logic in ComputationEngine and SimulationState.

Use built-in mocking (vi.spyOn or jest.spyOn) to test interactions between modules without depending on their internal implementation.

🚀 Extensibility
Write code with future enhancements in mind. For example, abstract the potential field logic to easily allow for saving/loading user-drawn scenarios.

Support adding new preset simulations through configuration rather than hard-coding them into the UI logic.

🚫 No Emojis in Code
Emojis are not permitted in code files, including comments.

🎯 Professionalism
No quick fixes, "hacks," or side effects. Functions should be predictable.

All code should be clean, readable, and self-explanatory.