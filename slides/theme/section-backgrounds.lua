-- Give every section slide (a heading above `slide-level`) a full-bleed
-- background colour, taken from the `section-background-color` metadata.
-- A heading that sets its own background-color keeps it.

function Pandoc(doc)
  local color = doc.meta["section-background-color"]
  if not color then
    return doc
  end
  color = pandoc.utils.stringify(color)

  -- quarto passes slide-level to pandoc as an option, not as metadata
  local slide_level = (PANDOC_WRITER_OPTIONS and PANDOC_WRITER_OPTIONS.slide_level)
    or tonumber(pandoc.utils.stringify(doc.meta["slide-level"] or ""))
    or 2

  return doc:walk({
    Header = function(h)
      if h.level < slide_level and not h.attributes["background-color"] then
        h.attributes["background-color"] = color
        return h
      end
    end,
  })
end
