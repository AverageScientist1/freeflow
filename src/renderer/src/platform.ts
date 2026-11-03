// Small differences between Windows and a Mac.
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

// The key that deletes: Delete on Windows; on a Mac the key labelled "delete" is Backspace (Delete there is Fn + delete).
export const isDeleteKey = (key: string): boolean => key === 'Delete' || (IS_MAC && key === 'Backspace')

// How the key is written in menus.
export const DELETE_LABEL = IS_MAC ? '⌫' : 'Delete'