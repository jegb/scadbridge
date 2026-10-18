import { execute, getApi } from './solidcraft';

/** Leave the start page and frame the current model in the viewport. */
export async function showDesign(): Promise<void> {
  try {
    await getApi().request('ui.home', { open: false });
  } catch {
    // ui.home is a control method; a host without it still shows the design.
  }
  try {
    await execute('view.apply', { view: 'iso' });
  } catch {
    // Framing is cosmetic; the imported model is already in the design.
  }
}
