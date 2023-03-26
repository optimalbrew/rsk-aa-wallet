import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
//import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { TwoUserMultisig__factory } from "../typechain-types";
import { TransactionStruct } from "../typechain-types/contracts/TwoUserMultisig";
import { BigNumber } from "ethers";
import { UnsignedTransaction, serialize, parse } from "../scripts/localEthersTrans";
//import { TransactionRequest } from '@ethersproject/providers';
//import { keccak256 } from "@ethersproject/keccak256";

describe("AA-test", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployAATestFixture() {

    // Contracts are deployed using the first signer/account by default
    const [owner1, owner2,  otherAccount] = await ethers.getSigners();

    // deploy the mintable erc20 contract
    const ONE_GWEI = 1_000_000_000n; //use bigint throughout
    const initBtcPrice = 23000n; // DOC per BTC
    const initFee =  210n * 6n * ONE_GWEI; //21000 gas at gasprice of 0.06 gwei

    const ERC20 = await ethers.getContractFactory("DummyDocMint");
    const erc20 = await ERC20.deploy(owner1.address, initFee , initBtcPrice, { value: 0 });

    const TwoUserMultisig = await ethers.getContractFactory("TwoUserMultisig");
    const twoUserMultisig = await TwoUserMultisig.deploy();

    // initialize the wallet this will revert if addresses are the same
    await twoUserMultisig.init(owner1.getAddress(), owner2.getAddress());
  
    return { erc20, initFee , initBtcPrice, twoUserMultisig, owner1, owner2, otherAccount };
  }

  describe("Init and serialization checks", function () {
    it("Should set the right 1st owner", async function () {
      const { twoUserMultisig, owner1 } = await loadFixture(deployAATestFixture);

      expect(await twoUserMultisig.owner1()).to.equal(owner1.address);
    });

    it("Should set the right 2nd owner", async function () {
      const { twoUserMultisig, owner2 } = await loadFixture(deployAATestFixture);

      expect(await twoUserMultisig.owner2()).to.equal(owner2.address);
    });

    it("Should revert if another initialization is attempted", async function(){
      const { twoUserMultisig, owner1, owner2 } = await loadFixture(deployAATestFixture);
      await expect(twoUserMultisig.init(owner1.getAddress(), owner2.getAddress())).to.be.revertedWith("contract already initialized");
    });

    it("Should decode transaction struct and fail due to balance", async function(){
      const { twoUserMultisig, owner1, owner2 } = await loadFixture(deployAATestFixture);
      const data = '0xdededada';
      const sig = '0xdeadbeef'; //needs to be multiples of 65 bytes for each ECDSA sig rsv(32+32+1)
      
      let tx:TransactionStruct;
      tx = {
        txType: BigNumber.from(3), 
        to: owner1.getAddress(),
        from: owner2.getAddress(),
        gasLimit: BigNumber.from(2000000),
        gasPrice: BigNumber.from(1),
        nonce: BigNumber.from(0),
        value: BigNumber.from(0),
        data: data, 
        signature: sig,
      }
    
      // test tx struct decoded properly
      //await twoUserMultisig.printTxandHash(tx);
      //todo(shree) some made-up hash -- separate test to check hashes
      let hash = ethers.utils.keccak256(data);
      //
      await expect(twoUserMultisig.validateTransaction(hash, tx)).to.be.revertedWith("Not enough balance for fee + value");
    });


    it("expect tx serialization and hash from contract to match input data", async function() {
      const { twoUserMultisig, owner1, owner2 } = await loadFixture(deployAATestFixture);
      const data = '0xdededada';
      const sig = '0xdeadbeef'; //needs to be multiples of 65 bytes for each ECDSA sig rsv(32+32+1)
      const val = 0;

      let tx:TransactionStruct;
      tx = {
        txType: BigNumber.from(3), 
        to: owner1.getAddress(),
        from: owner2.getAddress(),
        gasLimit: BigNumber.from(2000000),
        gasPrice: BigNumber.from(1),
        nonce: BigNumber.from(0),
        value: BigNumber.from(val),
        data: data, 
        signature: sig,
      }
      
      let aaTx = await newAATx(await owner1.getAddress(), await owner2.getAddress(), val, data, sig);
      const serializedAaTx = serialize(aaTx);
      //console.log("The serialized tx is:", serializedAaTx);
      //           nonce   gasprice   gaslimit   toaddr                                     value   data       chainid          fromAddr                                     customsig
      //0x03 f8 3e 8-0     0-1        83-1e8480  94-f39fd6e51aad88f6f4ce6ab8827279cfffb92266  8-0   84-dededada 82-7a69         94-70997970c51812dc3a010c7d01b50e0d17dc79c8 84-deadbeef

      const parsedAA = parse(serializedAaTx); //for the hash
      //console.log("The tx is:", parsedAA); 

      //await twoUserMultisig.printTxandHash(tx);
  
      // set excludeSig to false 
      let txEnc = await twoUserMultisig.getTxEncoded(tx, false);    
      //console.log("The encoded value is \n", txEnc);
      //console.log("Parsing the other tx: ", parse(txEnc));
      expect(serializedAaTx).to.equal(txEnc);

      let txHash = await twoUserMultisig.getTxHash(tx, false);
      //console.log(parsedAA.hash);
      //console.log(txHash);
      expect(txHash).to.equal(parsedAA.hash);
    });

  });

  describe("execution calls checks", function() {
    it("total supply check", async function() {
      const { erc20 } = await loadFixture(deployAATestFixture);
      let supply = await erc20.totalSupply();
      console.log(supply);
    });

    it("test mint and transfer call", async function() {
      const { erc20, twoUserMultisig, owner1, owner2, otherAccount } = await loadFixture(deployAATestFixture);
      
      let mintSel = funcSelector("mintDoc(uint256)");
      
      //amount of btc to be used for minting. 
      let toMint = '00000000000000000000000000000000000000000000000000038d7ea4c68000' ;//1M gwei (10^15) = 0.01 BTC, to be converted
    
      let mintcalldata = mintSel + toMint;
      console.log(mintcalldata);

      //const data = mintcalldata;
      const sig = '0xdeadbeef'; //needs to be multiples of 65 bytes for each ECDSA sig rsv(32+32+1)
      const val = 2_000_000 * 1000_000_000; //2M gwei

      let tx:TransactionStruct;
      tx = {
        txType: BigNumber.from(3), 
        to: erc20.address,
        from: owner1.getAddress(),
        gasLimit: BigNumber.from(2000000),
        gasPrice: BigNumber.from(await ethers.provider.getGasPrice()),
        nonce: BigNumber.from(0),
        value: BigNumber.from(val),
        data: mintcalldata, 
        signature: sig,
      }

      await twoUserMultisig.executeTransaction(tx, {value: val}); //value needs to be explit (the value " struct field" is only for internal logic and type 3)
      let supply = await erc20.totalSupply();
      console.log(supply);

      // call the usual way
      let directMint = await erc20.mintDoc(val/2, {value: val});

      supply = await erc20.totalSupply();
      console.log(supply);
      console.log(directMint);

      // transfer DOCs to someone else:
      // 0x a9059cbb 000000000000000000000000e700691da7b9851f2f35f8b8182c69c53ccad9db 000000000000000000000000000000000000000000000006c6b935b8bbd40000
      let transSel = funcSelector("transfer(address,uint256)");  //0xa9059cbb
      let transTo = await otherAccount.getAddress();
      let transAmt =  '0000000000000000000000000000000000000000000000013f306a2409fc0000'; //23000_000_000_000_000_000 .. = 23 DOC, 23e18 "gwei(DOC)"
      let transCallData  = transSel + '000000000000000000000000' + transTo.substring(2) + transAmt;
      console.log(transCallData);

      //update the fields, including nonce (not really needed)
      tx = {
        txType: BigNumber.from(3), 
        to: erc20.address,
        from: owner1.getAddress(),
        gasLimit: BigNumber.from(2000000),
        gasPrice: BigNumber.from(await ethers.provider.getGasPrice()),
        nonce: BigNumber.from(1),
        value: BigNumber.from(0),
        data: transCallData,
        signature: sig,
      }

      await twoUserMultisig.executeTransaction(tx, {value: 0});

      //check balance of recipient
      let recBal = await erc20.balanceOf(transTo);
      console.log('Recipient token balance is: ', recBal );
    });

    it("test batched mint and transfer call", async function() {
      const { erc20, twoUserMultisig, owner1, owner2, otherAccount } = await loadFixture(deployAATestFixture);
      
      let mintSel = funcSelector("mintDoc(uint256)");      
      //amount of btc to be used for minting. 
      let toMint = '00000000000000000000000000000000000000000000000000038d7ea4c68000' ;//1M gwei (10^15) = 0.01 BTC, to be converted
    
      let mintcalldata = mintSel + toMint;
      const sig = '0xdeadbeef'; //needs to be multiples of 65 bytes for each ECDSA sig rsv(32+32+1)
      const valMint = 2_000_000 * 1000_000_000; //2M gwei

      let txMint:TransactionStruct;
      txMint = {
        txType: BigNumber.from(3), 
        to: erc20.address,
        from: owner1.getAddress(),
        gasLimit: BigNumber.from(2000000),
        gasPrice: BigNumber.from(await ethers.provider.getGasPrice()),
        nonce: BigNumber.from(0),
        value: BigNumber.from(valMint),
        data: mintcalldata, 
        signature: sig,
      }
      
      // transfer DOCs to someone else:
      let transSel = funcSelector("transfer(address,uint256)");  //0xa9059cbb
      let transTo = await otherAccount.getAddress();
      let transAmt =  '0000000000000000000000000000000000000000000000013f306a2409fc0000'; //23000_000_000_000_000_000 .. = 23 DOC, 23e18 "gwei(DOC)"
      let transCallData  = transSel + '000000000000000000000000' + transTo.substring(2) + transAmt;
      let transTxVal = 0;

      let txTransfer:TransactionStruct;
      txTransfer = {
        txType: BigNumber.from(3), 
        to: erc20.address,
        from: owner1.getAddress(),
        gasLimit: BigNumber.from(2000000),
        gasPrice: BigNumber.from(await ethers.provider.getGasPrice()),
        nonce: BigNumber.from(1),
        value: BigNumber.from(transTxVal),
        data: transCallData,
        signature: sig,
      }

      //single call to wallet for both TX. Values need to be added
      let txList: TransactionStruct[] = [txMint, txTransfer];
      await twoUserMultisig.executeBatchTransaction(txList, {value: valMint + transTxVal});

      //check balance of recipient
      let recBal = await erc20.balanceOf(transTo);
      console.log('Recipient token balance after batched mint and transfer is: ', recBal );
    });
  });

});






//test helpers
// populate a new AA 4337 TX Type based on TransactionRequest
async function newAATx(to: string, from: string, value: number, data: string, customSig: string): Promise<UnsignedTransaction>  {
  const chainId = (await ethers.provider.getNetwork()).chainId 

  let tx: UnsignedTransaction;
  tx = {
      to: to, 
      from: from,
      chainId: chainId,
      nonce: 0,//await ethers.provider.getTransactionCount(from),
      value: value,
      data: data,
      gasLimit: 2000000,
      gasPrice: 1,//await ethers.provider.getGasPrice(),
      type: 3,
      customSig: customSig,
  };
  return tx;
};

// returns first 4 bytes of method signature
function funcSelector(func:string): string {
  return  ethers.utils.keccak256(ethers.utils.toUtf8Bytes(func)).substring(0,10);
}
