import { ref } from 'vue';

/** Only one popup menu is open at a time; opening another closes the previous one. */
export const openMenu = ref<string | null>(null);

export function toggleMenu(id: string) {
  openMenu.value = openMenu.value === id ? null : id;
}

export function closeMenus() {
  openMenu.value = null;
}
