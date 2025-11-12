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
        "no-console": "off",
        "no-debugger": "error",
        "no-unreachable": "off",
        "no-undef": "off",
        "no-unmodified-loop-condition": "off",
        "no-useless-concat": "off",
        "no-useless-escape": "off",
        "no-unused-vars": "off",
        semi: "off",
        quotes: "off",
        indent: "off",
        "comma-dangle": "off",
        "space-before-function-paren": "off",
    },
}];