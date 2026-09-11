# Function naming specification

## Core rule

Name functions by what they do, not where they live.

The name should answer two questions:
- what kind of thing does this function act on?
- what kind of effect or result does it have?

Keep one verb family per meaning. Do not use two families for the same job.

## Main families

### `build*`
Returns HTML markup.

- no side effects
- returns a string of HTML
- not for elements, widgets, or DOM writes

Examples:
- `buildButton`
- `buildFilterBar`

### `create*`
Creates and returns a stateful thing.

- may allocate state
- may close over state
- returns an object, controller, widget, table, chart, or live element wrapper
- not for plain data mapping

Examples:
- `createTabDock`
- `createComparison`
- `createCardGrid`

### `render*`
Writes visible UI.

- may replace, fill, or redraw a region
- may call `build*`
- use when the function owns the draw/redraw of a visible part of the page

Examples:
- `renderHtml`
- `renderBreakdown`
- `renderPage`

### `update*`
Makes existing DOM or UI match current state.

- does not imply a full redraw
- works on existing DOM, widget state, or controller state
- use for reconciliation of visible UI, not creation

Examples:
- `updateTabState`
- `updatePanelVisibility`
- `updateChecks`
- `updateRange`

### `highlight*`
Adds visual emphasis to an already-rendered thing.

- visual emphasis only
- not for general state reconciliation
- not for building or replacing UI

Examples:
- `highlightSelectedCards`
- `highlightOpenPlot`

### `reconcile*`
Changes or recomputes owned state.

- state-facing counterpart to `update*`
- use when the function aligns derived, aggregate, or reconciled state
- may trigger a later render or update, but the name is about state

Examples:
- `reconcileScores`
- `reconcileGroups`
- `reconcileSelectionState`

### `set*`
Assigns one explicit value.

- narrow, direct mutation
- use for one property, field, value, or target
- if the function recomputes several things, prefer `reconcile*`

Examples:
- `setRows`
- `setSelection`
- `setText`
- `setButtonLabel`

### `ensure*`
Creates something lazily if missing, then returns it.

- may allocate on first call
- returns the existing thing thereafter
- use when a thing is created on demand and kept

Examples:
- `ensureAuth`
- `ensureTaskDetail`

### `apply*`
Applies a chosen change, mode, patch, or selection to an existing target.

- use when the important action is enacting a change
- not for ordinary DOM refresh
- not for pure state recomputation

Examples:
- `applyFilters`
- `applySelection`
- `applyFieldMeta`

### `format*`
Returns display text.

- no side effects
- returns a human-readable string
- not for HTML or general shape conversion

Examples:
- `formatDate`
- `formatCount`

## Reading and loading

### `get*`
Looks up or derives an already-available value.

- no side effects
- usually synchronous
- may read existing state, arguments, or DOM references
- not for DOM writes or lazy creation

Examples:
- `getElement`
- `getSectionBody`
- `getVisibleTabs`

### `load*`
Brings something in from outside the current state, or boots a larger flow.

- often async
- may fetch, hydrate, or prepare a page or feature
- use when the work crosses a boundary

Examples:
- `loadPage`
- `loadCreatePage`
- `loadSubmissionContext`

### `read*`
Reads current encoded state into data.

- use for DOM, URL, form, or serialized input
- no fetching
- no UI writes

Examples:
- `readUrl`
- `readTasks`
- `readSelection`

### `write*`
Writes encoded or externalized state.

- use for URL params, serialized output, or similar boundary formats
- not for ordinary state mutation

Examples:
- `writeUrl`
- `writeTasks`
- `writeSelection`

## Transformation families

### `to*`
Maps one shape into another.

- pure transformation
- returns a new value in a different shape
- not for lookups or side effects

Examples:
- `toModelRows`
- `toCompareRows`
- `toTaskTypeGroups`

### `normalize*`
Converts input into a standard internal form.

- preserves meaning while standardizing shape or content
- not for display formatting
- not for arbitrary remapping where `to*` is clearer

Examples:
- `normalizeObject`
- `normalizeOption`

### `*For`
Returns the thing chosen or appropriate for a context.

- use for selection, assignment, or suitability
- answers "what should be used for this?"
- not for describing what a subject is

Examples:
- `fieldsForPanel`
- `metricFor`
- `categoriesFor`

### `*From`
Extracts or derives a value from a source.

Examples:
- `pinFromEvent`
- `paramsFromUrl`
- `dropFromClick`

### `*In`
Finds or reads something within a container or scope.

Examples:
- `rangeIn`
- `pinnedIn`
- `elementIn`

### `*Of`
Returns a property, label, type, or identity of a subject.

- use for description, classification, or identity
- answers "what is this thing's type/value/label?"
- not for choosing what to use with it

Examples:
- `taskTypeOf`
- `labelOf`
- `valueOf`

Use both families, but keep them narrow:
- `*For` chooses
- `*Of` describes

Do not force either one where a direct name is clearer.

## Lifecycle and interaction

### `attach*`
Wires listeners, bindings, or interaction behavior.

- use for attaching listeners or bindings to an existing thing
- not for creating the thing being attached

Examples:
- `attachEvents`
- `attachTabEvents`
- `attachFieldEvents`

### `handle*`
Is an event-driven entry point.

- use for a listener or callback reached from an event or delegated interaction
- may call `reconcile*`, `update*`, `render*`, or `apply*`
- name the interaction it handles when possible

Examples:
- `handleFieldChange`
- `handleDrop`
- `handleSearch`

### `clear*`
Removes content, state, or cached values.

- the thing remains usable afterwards
- not for final teardown

Examples:
- `clearContent`
- `clearDetails`
- `clearPlots`

### `destroy*`
Tears down a stateful thing and releases what it owns.

- use for final cleanup
- may remove listeners, clear DOM, and dispose child resources
- not for ordinary clearing or resetting

Examples:
- `destroy`
- `destroyTable`

### `toggle*`
Switches between two states or turns one state on/off.

- use only for a genuine binary switch
- not for choosing among many states

Examples:
- `toggleComparison`
- `toggleHelpPin`

### `drop*`
Removes a held item or selection.

- use for removal from a set, selection, or tracked collection
- not for generic deletion of a persisted record

Examples:
- `drop`
- `dropFromClick`

## Predicates

### `is*`
Boolean predicate.

- use for validity, identity, type, or state checks

Examples:
- `isAuthenticated`
- `isComplete`
- `isValidZip`

### `has*`
Boolean predicate for presence or dependency.

- use for possession, presence, or whether something is available

Examples:
- `hasContent`
- `hasDependentFields`

### `can*`
Boolean capability or permission.

- use for whether an action is allowed or possible

Examples:
- `canSelect`

## API exception

API modules may keep `get*`, `create*`, and `load*`.

Use them as follows:
- `get*` for read endpoints
- `create*` for create endpoints
- `load*` where the API helper is specifically loading or hydrating a larger record or flow

Do not force API names into the UI rules when the HTTP action is clearer.

Examples:
- `getModels`
- `createTeam`
- `loadSubmission`

## Short chooser

- returns HTML -> `build*`
- creates a stateful thing -> `create*`
- writes or redraws visible UI -> `render*`
- reconciles existing UI to state -> `update*`
- visually emphasizes something already drawn -> `highlight*`
- changes or recomputes state -> `reconcile*`
- assigns one explicit value -> `set*`
- creates lazily if missing -> `ensure*`
- enacts a chosen change on a target -> `apply*`
- returns display text -> `format*`
- looks up or derives an available value -> `get*`
- fetches or boots from outside -> `load*`
- reads current DOM/URL/input state -> `read*`
- writes URL/serialized state -> `write*`
- maps one shape to another -> `to*`
- converts input into a standard internal form -> `normalize*`
- tears a stateful thing down -> `destroy*`
- handles an event or delegated interaction -> `handle*`
- chooses a value for a context -> `*For`
- describes a property of a subject -> `*Of`
- returns a boolean state/type/capability answer -> `is*` / `has*` / `can*`

