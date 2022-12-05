import { stripPrefix } from "./utils";

export function resolveAllValues(data, unresolvedKeys, allData) {
    // Init already resolved keys.
    let resolvedKeys = new Set();
    for (const [key, val] of data) {
        if (_isResolved(val)) {
            resolvedKeys.add(key);
        }
    }

    // Resolve other keys.
    while (_resolveStep(data, resolvedKeys, allData));

    // Return the unresolvedKeys
    if (unresolvedKeys != null) {
        for (const [key, val] of data) {
            if (!_isResolved(val)) {
                unresolvedKeys.add(key);
            }
        }
    }
    return data;
}

function _resolveStep(data, resolvedKeys, allData) {
    let changedKey = null;
    let changedValue = null;
    for (const [key, val] of data) {
        if (!resolvedKeys.has(key)) {
            let newValue = _resolveOneValue(key, val, data, allData, resolvedKeys);
            if (val != newValue) {
                changedKey = key;
                changedValue = newValue;
                // We break here to avoid modifying data while iterating on it.
                break;
            }
        }
    }
    if (changedKey != null) {
        if (_isResolved(changedValue)) {
            resolvedKeys.add(changedKey);
            changedValue = _getResolvedValue(changedValue, allData);
        }
        data.set(changedKey, changedValue);
        return true;
    }
    return false;
}

// Do not modify data, but ok to modify resolvedKeys.
function _resolveOneValue(key, value, data, allData, resolvedKeys) {
    let neededKeys = _extractNeededKeys(value);
    let allResolved = true;
    for (let neededKey of neededKeys) {
        if (resolvedKeys.has(neededKey)) {
            value = value.replace('${' + neededKey + '}', data.get(neededKey));
        } else {
            allResolved = false;
        }
    }
    if (allResolved) {
        value = _getResolvedValue(value, allData);
    }
    return value;
}

function _extractNeededKeys(value) {
    let keys = [];
    for (let i = 0; i + 1 < value.length; ++i) {
        if (value[i] == '$' && value[i + 1] == '{') {
            let j = i + 2;
            while (j < value.length && value[j] != '}') j++;
            keys.push(value.slice(i + 2, j));
            i = j;
        }
    }
    return keys;
}
// Examples
//    ${x} == 2
//    ${name} != Anna
function _resolveComparison(value) {
    value = value.trim();
    if (value == 'true') {
        return true;
    }
    if (value == 'false') {
        return false;
    }
    let equality = true;
    let j = value.indexOf('==');
    if (j < 0) {
        equality = false;
        j = value.indexOf('!=');
    }
    if (j < 0) {
        throw 'incorrect syntax: ' + value;
    }
    let val1 = value.slice(0, j).trim();
    let val2 = value.slice(j + 2).trim();
    let equal = val1 == val2;
    return equality ? equal : !equal;
}

// Examples:
//   "0    == 1"
//   "blah == 10 && ${x} == 10 || ${y} == 20"
function _resolveCondition(value) {
    let orResult = false;
    for (let orComponent of value.split('||')) {
        let andResult = true;
        for (let v of orComponent.split('&&')) {
            andResult &&= _resolveComparison(v)
        }
        orResult ||= andResult;
    }
    return orResult;
}

// Examples:
//   "$varif ${x} == 100  ?? 10    :: 20"
//   "$varif ${x} == blah ?? blah1 :: blah2"
function _resolveVarif(value) {
    if (!value.includes('??')) {
        throw '$varif incorrect syntax: ' + value;
    }
    let j = value.indexOf('??');
    let val1 = value.slice(0, j).trim();
    value = value.slice(j + 2).trim();
    if (!value.includes('::')) {
        throw '$varif incorrect syntax (missing colon): ' + value;
    }
    let k = value.indexOf('::');
    let val2 = value.slice(0, k).trim();
    let val3 = value.slice(k + 2).trim();
    return _resolveCondition(val1) ? val2 : val3;
}

// Examples:
//   "$varbookref isbn 123456789      !! name"   <-- get name of the book with that isbn
//   "$varbookref name Clara          !! asin "  <-- get asin of the book with key name=Clara
//   "$varbookref name Clara, lang RU !! title"   <-- title isbn of the book with keys name=Clara lang=RU
function _resolveVarbookref(value, allData) {
    if (!value.includes('!!')) {
        throw '$varbookref incorrect syntax: ' + value;
    }
    let j = value.indexOf('!!');
    let searchKeys = value.slice(0, j).trim();
    let fieldToExtract = value.slice(j + 2).trim();
    let matchedBookField = _getBookField(allData, searchKeys, fieldToExtract);
    // If no match, return empty string
    return matchedBookField != null ? matchedBookField : '';
}

function _getResolvedValue(value, allData) {
    if (value.startsWith('$var')) {
        if (value.startsWith('$vareq ')) {
            return _resolveCondition(stripPrefix(value, '$vareq ')) ? 'true' : 'false';
        } else if (value.startsWith('$varif ')) {
            return _resolveVarif(stripPrefix(value, '$varif '));
        } else if (value.startsWith('$varbookref ')) {
            return _resolveVarbookref(stripPrefix(value, '$varbookref '), allData);
        } else {
            throw new Error('Unknown key starting with a special prefix $var. Expected are $vareq, $varif and $varbookref')
        }
    }
    return value;
}

function _isResolved(value) {
    return !value.includes('${') && !value.startsWith('$var');
}

function _getBookField(allData, searchKeys, fieldToExtract) {
    let matchedData = null;
    for (let data of allData) {
        if (_dataMatchesKeys(data, searchKeys)) {
            if (matchedData == null) {
                matchedData = data;
            } else {
                throw new Error('Matched more than one record for key: ' + searchKeys);
            }
        }
    }
    if (matchedData == null) {
        return null; // No match
    }
    if (!matchedData.has(fieldToExtract)) {
        throw new Error("No such key: " + fieldToExtract);
    }
    return matchedData.get(fieldToExtract);
}

function _dataMatchesKeys(data, searchKeys) {
    for (const keyVal of searchKeys.split("&&")) {
        let v = keyVal.trim().split("==");
        if (v.length != 2) {
            throw new Error("Incorrect syntax of search key: " + keyVal);
        }
        let keyName = v[0].trim();
        let keyValue = v[1].trim();
        if (!data.has(keyName)) {
            throw new Error('No such key: ' + keyName);
        }
        let val = data.get(keyName);
        if (val != keyValue) {
            return false; // No match
        }
    }
    return true;
}