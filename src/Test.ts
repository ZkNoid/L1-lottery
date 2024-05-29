import { SmartContract, method } from 'o1js';

export class Test extends SmartContract {
  init() {
    super.init();

    this.network.blockchainLength.getAndRequireEquals();

    // #TODO Permisions
  }

  @method async some() {
    //
  }
}
