declare module "react-cytoscapejs" {
  import type { CSSProperties, ComponentType } from "react";
  import type { Core, ElementDefinition, Stylesheet, LayoutOptions } from "cytoscape";

  type CytoscapeProps = {
    elements?: ElementDefinition[];
    style?: CSSProperties;
    layout?: LayoutOptions;
    stylesheet?: Stylesheet[];
    cy?: (core: Core) => void;
  };

  const CytoscapeComponent: ComponentType<CytoscapeProps>;
  export default CytoscapeComponent;
}
