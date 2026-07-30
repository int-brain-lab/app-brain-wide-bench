import {renderSubmissionList} from "./list-view.js";
import { getSubmissions} from "../api.js";



async function initialise() {

  const submissions = await getSubmissions();

  console.log(submissions)
  if (!submissions) {
    return
  }

  renderSubmissionList(submissions);
}

initialise()
