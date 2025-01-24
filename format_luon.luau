local function trim(s)
    return s:gsub("^%s*(.-)%s*$", "%1")
end

local function prettyPrint(t, indent, needcomma)
    indent = indent or 0
    local spacing = string.rep("    ", indent)
    local result = ""
    local currentPos = 0
    
    if type(t) == "table" then
        local isArray = #t > 0
        result..= "{\n"
        currentPos = currentPos + 2
        
        local keys = {}
        for k in pairs(t) do
            table.insert(keys, k)
        end
        if not isArray then
            table.sort(keys)
        end
        
        for i, k in ipairs(keys) do
            local v = t[k]
            local lineStart = ""
            if not isArray then
                lineStart = spacing .. "    " .. (tonumber(k) and `["{k}"]` or k) .. " = "
            else
                lineStart = spacing .. "    "
            end
            result..= lineStart
            if type(v) == "table" then
                result..= prettyPrint(v, indent + 1, i ~= #keys)
            elseif type(v) == "string" then
                result..= '"' .. v .. '"' .. (i == #keys and "\n" or ",\n")
            else
                result..= tostring(v) .. (i == #keys and "\n" or ",\n")
            end
        end
        
        result..= spacing .. (needcomma and "},\n" or "}\n")
        return result
    else
        result..= tostring(t) .. (needcomma and ",\n" or "\n")
        currentPos = currentPos + #tostring(t) + 1
        return result, currentPos
    end
end

local input = ... or ""

if #input == 0 then
    error("Error: No input provided\n")
end

local chunk, err = loadstring("return " .. input, "luon", "t", {})
if not chunk then
    error("Error: Invalid LUON syntax - " .. err .. "\n")
end

local result
local success, eresult = pcall(function()result = chunk()end)
if not success then
    error("Error: " .. eresult .. "\n")
end

print(table.pack(prettyPrint(result, 0))[1])