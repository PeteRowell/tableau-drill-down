/**
 * Hierarchical Drill-Down Crosstab Extension for Tableau
 * Allows users to click on rows to drill down into hierarchical data
 */

(function() {
    'use strict';

    // Global state
    let worksheet = null;
    let hierarchyFields = [];
    let measureFields = [];
    let fullDataTree = null;
    let expandedNodes = new Set(); // Track which nodes are expanded

    // Initialize the extension
    tableau.extensions.initializeAsync().then(() => {
        console.log('Extension initialized successfully');
        loadData();
    }).catch(err => {
        showError('Failed to initialize extension: ' + err.message);
    });

    /**
     * Load data from the Tableau worksheet
     */
    async function loadData() {
        try {
            // Get the worksheet
            worksheet = tableau.extensions.worksheetContent.worksheet;
            console.log('Worksheet loaded:', worksheet.name);

            // Get the summary data
            const dataTable = await worksheet.getSummaryDataReaderAsync();
            
            // Get column information
            const columns = dataTable.columns;
            console.log('Columns:', columns.map(c => ({ fieldName: c.fieldName, dataType: c.dataType })));

            // Identify hierarchy fields (dimensions in rows) and measures
            identifyFieldTypes(columns);

            if (hierarchyFields.length === 0) {
                showError('No hierarchy fields found. Please ensure you have dimensions in the Rows shelf.');
                return;
            }

            if (measureFields.length === 0) {
                showError('No measure fields found. Please ensure you have measures in the view.');
                return;
            }

            // Read all data pages
            let allData = [];
            for (let page of dataTable.pages) {
                allData = allData.concat(page.data);
            }

            await dataTable.releaseAsync();

            console.log('Total rows loaded:', allData.length);
            console.log('Hierarchy fields:', hierarchyFields);
            console.log('Measure fields:', measureFields);

            // Build the hierarchical tree structure
            fullDataTree = buildHierarchicalTree(allData);
            console.log('Data tree built:', fullDataTree);

            // Render the initial table (only top level)
            renderTable();

            // Hide loading, show container
            document.getElementById('loading').style.display = 'none';
            document.getElementById('container').style.display = 'block';

        } catch (err) {
            console.error('Error loading data:', err);
            showError('Error loading data: ' + err.message);
        }
    }

    /**
     * Identify which columns are hierarchy fields and which are measures
     */
    function identifyFieldTypes(columns) {
        hierarchyFields = [];
        measureFields = [];

        columns.forEach(col => {
            // Dimensions that are not measures are hierarchy fields
            if (col.dataType === 'string' || col.dataType === 'date-time' || col.dataType === 'date') {
                hierarchyFields.push({
                    index: col.index,
                    fieldName: col.fieldName
                });
            } else if (col.dataType === 'float' || col.dataType === 'int') {
                measureFields.push({
                    index: col.index,
                    fieldName: col.fieldName
                });
            }
        });
    }

    /**
     * Build a hierarchical tree structure from flat data
     */
    function buildHierarchicalTree(data) {
        const tree = {};

        data.forEach(row => {
            let currentLevel = tree;

            // Build path through hierarchy
            hierarchyFields.forEach((field, levelIndex) => {
                const value = row[field.index].value;
                
                if (value === null || value === undefined || value === '%null%') {
                    return; // Skip null values
                }

                // Create node if it doesn't exist
                if (!currentLevel[value]) {
                    currentLevel[value] = {
                        name: value,
                        level: levelIndex,
                        measures: {},
                        children: {},
                        hasChildren: levelIndex < hierarchyFields.length - 1
                    };
                }

                // Store measure values at this node
                measureFields.forEach(measure => {
                    const measureValue = row[measure.index].value;
                    if (measureValue !== null && measureValue !== undefined) {
                        currentLevel[value].measures[measure.fieldName] = measureValue;
                    }
                });

                // Move to next level
                currentLevel = currentLevel[value].children;
            });
        });

        return tree;
    }

    /**
     * Render the crosstab table
     */
    function renderTable() {
        const table = document.getElementById('crosstab');
        table.innerHTML = '';

        // Create header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        // Hierarchy column header
        const hierarchyHeader = document.createElement('th');
        hierarchyHeader.textContent = hierarchyFields[0].fieldName;
        headerRow.appendChild(hierarchyHeader);

        // Measure column headers
        measureFields.forEach(measure => {
            const th = document.createElement('th');
            th.className = 'measure-header';
            th.textContent = measure.fieldName;
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Create body
        const tbody = document.createElement('tbody');
        renderTreeLevel(fullDataTree, tbody, 0, []);
        table.appendChild(tbody);
    }

    /**
     * Recursively render tree levels
     */
    function renderTreeLevel(treeLevel, tbody, level, path) {
        const sortedKeys = Object.keys(treeLevel).sort();

        sortedKeys.forEach(key => {
            const node = treeLevel[key];
            const currentPath = [...path, key];
            const pathKey = currentPath.join('|');

            // Create row
            const row = document.createElement('tr');
            row.setAttribute('data-level', level);
            row.setAttribute('data-path', pathKey);
            
            // Check if this node is expanded
            const isExpanded = expandedNodes.has(pathKey);
            if (isExpanded) {
                row.classList.add('expanded');
            }

            // Row header (hierarchy value)
            const rowHeader = document.createElement('td');
            rowHeader.className = 'row-header';
            
            const rowContent = document.createElement('div');
            rowContent.className = 'row-content';

            // Add indentation
            const indent = document.createElement('span');
            indent.className = 'indent';
            indent.style.width = (level * 24) + 'px';
            rowContent.appendChild(indent);

            // Add expand/collapse icon if node has children
            if (node.hasChildren && Object.keys(node.children).length > 0) {
                const icon = document.createElement('span');
                icon.className = 'expand-icon' + (isExpanded ? ' expanded' : '');
                icon.innerHTML = '▸';
                rowContent.appendChild(icon);
            } else {
                const spacer = document.createElement('span');
                spacer.className = 'expand-icon hidden';
                spacer.innerHTML = '&nbsp;';
                rowContent.appendChild(spacer);
            }

            // Add node name
            const nameSpan = document.createElement('span');
            nameSpan.textContent = node.name;
            rowContent.appendChild(nameSpan);

            rowHeader.appendChild(rowContent);
            row.appendChild(rowHeader);

            // Add click handler
            if (node.hasChildren && Object.keys(node.children).length > 0) {
                rowHeader.addEventListener('click', () => {
                    toggleNode(currentPath);
                });
            }

            // Measure cells
            measureFields.forEach(measure => {
                const cell = document.createElement('td');
                cell.className = 'measure-cell';
                const value = node.measures[measure.fieldName];
                if (value !== undefined && value !== null) {
                    cell.textContent = formatNumber(value);
                } else {
                    cell.textContent = '';
                }
                row.appendChild(cell);
            });

            tbody.appendChild(row);

            // If expanded, render children
            if (isExpanded && node.hasChildren && Object.keys(node.children).length > 0) {
                renderTreeLevel(node.children, tbody, level + 1, currentPath);
            }
        });
    }

    /**
     * Toggle node expansion/collapse
     */
    function toggleNode(path) {
        const pathKey = path.join('|');
        
        if (expandedNodes.has(pathKey)) {
            // Collapse: remove this node and all descendants
            const pathsToRemove = Array.from(expandedNodes).filter(p => 
                p === pathKey || p.startsWith(pathKey + '|')
            );
            pathsToRemove.forEach(p => expandedNodes.delete(p));
        } else {
            // Expand: add this node
            expandedNodes.add(pathKey);
        }

        // Re-render the table
        renderTable();
    }

    /**
     * Format numbers for display
     */
    function formatNumber(value) {
        if (typeof value === 'number') {
            // Check if it's a currency value (heuristic: large numbers)
            if (Math.abs(value) >= 100) {
                return '$' + value.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0
                });
            } else {
                return value.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2
                });
            }
        }
        return value;
    }

    /**
     * Show error message
     */
    function showError(message) {
        const errorDiv = document.getElementById('error');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        document.getElementById('loading').style.display = 'none';
        console.error(message);
    }

})();
