import { expect } from "chai";
import { ethers } from "hardhat";

describe("CharityChain", () => {
  async function fixture() {
    const [admin, organizer, donor, other] = await ethers.getSigners();
    const contract = await (await ethers.getContractFactory("CharityChain")).deploy();
    await contract.waitForDeployment();
    await contract.connect(organizer).registerCharity("Hope", "A test charity", "REF-1", "https://example.com/evidence");
    await contract.connect(organizer).createCampaign(1, "Food", "Test campaign", "Food and Shelter", ethers.parseEther("5"), "");
    return { contract, admin, organizer, donor, other };
  }

  it("registers and verifies charities with admin access control", async () => {
    const { contract, admin, organizer, other } = await fixture();
    await expect(contract.connect(other).updateCharityVerification(1, true)).to.be.revertedWithCustomError(contract, "Unauthorized");
    await expect(contract.connect(admin).updateCharityVerification(1, true)).to.emit(contract, "CharityVerificationUpdated").withArgs(1, true);
    expect((await contract.charities(1)).verified).to.equal(true);
    expect((await contract.charities(1)).organizer).to.equal(organizer.address);
  });

  it("accepts donations and rejects zero or inactive donations", async () => {
    const { contract, donor, organizer } = await fixture();
    await expect(contract.connect(donor).donate(1, { value: ethers.parseEther("1") })).to.emit(contract, "DonationReceived");
    expect((await contract.campaigns(1)).totalRaised).to.equal(ethers.parseEther("1"));
    await expect(contract.connect(donor).donate(1)).to.be.revertedWithCustomError(contract, "InvalidAmount");
    await contract.connect(organizer).setCampaignStatus(1, 2);
    await expect(contract.connect(donor).donate(1, { value: 1 })).to.be.revertedWithCustomError(contract, "InactiveCampaign");
  });

  it("accounts for pending expenses and releases each approved expense once", async () => {
    const { contract, admin, organizer, donor } = await fixture();
    await contract.connect(donor).donate(1, { value: ethers.parseEther("3") });
    await contract.connect(organizer).requestExpense(1, ethers.parseEther("2"), "Supplies", "https://example.com/invoice");
    expect(await contract.availableFunds(1)).to.equal(ethers.parseEther("1"));
    await expect(contract.connect(organizer).requestExpense(1, ethers.parseEther("2"), "Too much", "")).to.be.revertedWithCustomError(contract, "InsufficientAvailableFunds");
    await expect(contract.connect(admin).approveExpense(1)).to.emit(contract, "FundsReleased").withArgs(1, 1, organizer.address, ethers.parseEther("2"));
    expect(await contract.availableFunds(1)).to.equal(ethers.parseEther("1"));
    await expect(contract.connect(admin).approveExpense(1)).to.be.revertedWithCustomError(contract, "InvalidStatus");
    await expect(contract.connect(admin).rejectExpense(1)).to.be.revertedWithCustomError(contract, "InvalidStatus");
  });

  it("prevents unauthorized campaign and expense operations", async () => {
    const { contract, other, donor } = await fixture();
    await expect(contract.connect(other).createCampaign(1, "Nope", "Nope", "Education", 1, "")).to.be.revertedWithCustomError(contract, "NotOrganizer");
    await contract.connect(donor).donate(1, { value: 100 });
    await expect(contract.connect(other).requestExpense(1, 1, "Nope", "")).to.be.revertedWithCustomError(contract, "NotOrganizer");
  });
});
