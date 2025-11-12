import globals from "globals";

export default [{
    languageOptions: {
        globals: {
            ...globals.browser,
            ...globals.node,
        },

        ecmaVersion: "latest",
        sourceType: "module",
    },

    rules: {
        "no-eval": "error",
        "no-implied-eval": "error",
        "no-new-func": "off",
        "no-script-url": "error",
        "no-unsafe-finally": "off",
        "no-unsafe-negation": "off",
        "no-prototype-builtins": "off",
        "no-with": "off",
        "require-await": "off",
        "eqeqeq": "off",
    },
}];