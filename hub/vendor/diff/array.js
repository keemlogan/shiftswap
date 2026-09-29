/*! jsdiff 8.0.4 (npm "diff@8.0.4", file libesm/diff/array.js, unmodified below this comment) | BSD-3-Clause | Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com> | full license: LICENSE in this folder */
import Diff from './base.js';
class ArrayDiff extends Diff {
    tokenize(value) {
        return value.slice();
    }
    join(value) {
        return value;
    }
    removeEmpty(value) {
        return value;
    }
}
export const arrayDiff = new ArrayDiff();
export function diffArrays(oldArr, newArr, options) {
    return arrayDiff.diff(oldArr, newArr, options);
}
