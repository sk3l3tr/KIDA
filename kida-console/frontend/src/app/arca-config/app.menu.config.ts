import { MenuConfig, MenuPosition } from 'arca';

export const appMenu: MenuConfig = {
  title: "",
  floatingPosition: MenuPosition.disabled,
  fixedPosition: MenuPosition.disabled,
  itemsStyle: "",
  items: [
    {
      id: "ARCA001",
      title: "Display name",
      assetIcon: "*.png",
      style: "",
      path: "/path/to/redirect",
    },
    {
      title: "separator",
    },
  ],
};
