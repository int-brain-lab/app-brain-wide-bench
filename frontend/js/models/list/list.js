import {renderModelList} from "./list-view.js";
import { getMyModels } from "../api.js";



async function initialise() {

  const models = await getMyModels();
  if (!models) {
    return
  }

  renderModelList(models);
}

initialise()
